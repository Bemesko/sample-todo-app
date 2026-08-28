import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const npmCliPath =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const useNodeForNpm = Boolean(process.platform === 'win32' || process.env.npm_execpath);
const npmCommand = useNodeForNpm ? process.execPath : 'npm';
let shuttingDown = false;
let shutdownPromise;
const windowsProcessTrees = new Map();
let windowsRefreshPromise;

const processes = [
  ['client', ['run', 'dev', '--workspace', 'client']],
  ['server', ['run', 'dev', '--workspace', 'server']]
].map(([name, args]) => {
  const child = spawn(npmCommand, useNodeForNpm ? [npmCliPath, ...args] : args, {
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: 'inherit'
  });
  if (process.platform === 'win32') {
    windowsProcessTrees.set(child, {
      pids: child.pid ? new Set([child.pid]) : new Set(),
      refreshing: false
    });
  }

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`${name} process failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const status = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`${name} process exited with ${status}.`);
    shutdown(code ?? 1);
  });

  return child;
});

// Preserve descendant PIDs because taskkill cannot traverse an already-exited wrapper.
const windowsRefreshTimer =
  process.platform === 'win32'
    ? setInterval(() => {
        if (!shuttingDown) {
          void refreshWindowsProcessTrees();
        }
      }, 250)
    : null;
windowsRefreshTimer?.unref();
if (windowsRefreshTimer) {
  void refreshWindowsProcessTrees();
}

function shutdown(code) {
  if (shuttingDown) {
    return shutdownPromise;
  }

  const finalWindowsRefresh =
    process.platform === 'win32'
      ? refreshWindowsProcessTrees()
      : Promise.resolve();
  shuttingDown = true;
  if (windowsRefreshTimer) {
    clearInterval(windowsRefreshTimer);
  }
  process.exitCode = code;
  shutdownPromise = finalWindowsRefresh.then(() =>
    Promise.all(processes.map(terminateProcessTree))
  );
  return shutdownPromise;
}

function terminateProcessTree(child) {
  if (!child.pid) {
    return Promise.resolve();
  }

  if (process.platform === 'win32') {
    return terminateWindowsProcessTree(child);
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      child.kill();
    }
    return Promise.resolve();
  }

  const forceKill = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The process group already exited.
    }
  }, 2000);
  forceKill.unref();

  return waitForClose(child).finally(() => clearTimeout(forceKill));
}

function terminateWindowsProcessTree(child) {
  const processTree = windowsProcessTrees.get(child);
  const pids = processTree?.pids ?? new Set([child.pid]);

  return findWindowsDescendantPids(child.pid)
    .then((descendantPids) => {
      descendantPids.forEach((pid) => pids.add(pid));
    })
    .catch((error) => {
      console.error(
        `Could not inspect the ${child.pid} process tree: ${error.message}`
      );
    })
    .then(() =>
      [...pids].reduce(
        (promise, pid) =>
          promise.then(() => terminateWindowsProcess(pid, child)),
        Promise.resolve()
      )
    );
}

function refreshWindowsProcessTrees() {
  if (windowsRefreshPromise) {
    return windowsRefreshPromise;
  }

  windowsRefreshPromise = Promise.all(
    processes.map(async (child) => {
      const processTree = windowsProcessTrees.get(child);
      if (!processTree || !child.pid || processTree.refreshing) {
        return;
      }

      processTree.refreshing = true;
      try {
        const descendantPids = await findWindowsDescendantPids(child.pid);
        processTree.pids.add(child.pid);
        descendantPids.forEach((pid) => processTree.pids.add(pid));
      } catch {
        // The shutdown pass reports process-query failures explicitly.
      } finally {
        processTree.refreshing = false;
      }
    })
  ).finally(() => {
    windowsRefreshPromise = undefined;
  });

  return windowsRefreshPromise;
}

function findWindowsDescendantPids(rootPid) {
  const query = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& {
        param($rootPid)
        $ErrorActionPreference = 'Stop'
        $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId)
        $pending = [System.Collections.Generic.Queue[int]]::new()
        $seen = [System.Collections.Generic.HashSet[int]]::new()
        $pending.Enqueue([int]$rootPid)
        [void]$seen.Add([int]$rootPid)
        while ($pending.Count -gt 0) {
          $parentPid = $pending.Dequeue()
          foreach ($process in $processes) {
            $processPid = [int]$process.ProcessId
            if ([int]$process.ParentProcessId -eq $parentPid -and $seen.Add($processPid)) {
              $pending.Enqueue($processPid)
              $processPid
            }
          }
        }
      }`,
      String(rootPid)
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  );

  let stdout = '';
  let stderr = '';
  query.stdout.setEncoding('utf8');
  query.stderr.setEncoding('utf8');
  query.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  query.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    query.on('error', reject);
    query.on('close', (code, signal) => {
      if (signal) {
        reject(
          new Error(`process query exited on signal ${signal}.`)
        );
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || `process query exited with code ${code}.`
          )
        );
        return;
      }

      const output = stdout.trim();
      if (output === '') {
        resolve([]);
        return;
      }

      const pids = output.split(/\s+/).map(Number);
      if (pids.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
        reject(new Error('process query returned an invalid PID.'));
        return;
      }

      resolve([...new Set(pids)]);
    });
  });
}

function terminateWindowsProcess(pid, fallbackChild) {
  return new Promise((resolve) => {
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      {
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      }
    );

    killer.on('error', (error) => {
      console.error(`Could not terminate process ${pid}: ${error.message}`);
      if (pid === fallbackChild.pid) {
        fallbackChild.kill();
      } else {
        try {
          process.kill(pid);
        } catch (killError) {
          if (killError.code !== 'ESRCH') {
            console.error(
              `Could not terminate process ${pid}: ${killError.message}`
            );
          }
        }
      }
      resolve();
    });
    killer.on('close', resolve);
  });
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('close', resolve);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
