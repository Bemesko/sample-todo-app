[CmdletBinding()]
param(
  [ValidatePattern('^[a-z]{1,5}$')]
  [string]$ResourceToken = 'todo',

  [string]$SubscriptionId = '571400a1-1f0a-4d1f-9003-1bd19a468181',
  [string]$ResourceGroupName = 'azsampletodo',
  [string]$Location = 'brazilsouth',
  [string]$EnvironmentName = 'sampletodo',
  [string]$ImageRepository = 'sample-todo-app',
  [ValidateRange(1024, 65535)]
  [int]$LocalPort = 3011,
  [ValidateRange(60, 900)]
  [int]$PublicHealthTimeoutSeconds = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$mainTemplate = Join-Path $PSScriptRoot 'main.bicep'
$mainParameters = Join-Path $PSScriptRoot 'main.parameters.json'
$workloadTemplate = Join-Path $PSScriptRoot 'workload.bicep'
$localImageTag = "${ImageRepository}:local-${ResourceToken}"
$localContainerName = "sample-todo-local-${ResourceToken}"

function Assert-Command {
  param([Parameter(Mandatory)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-ExternalCommand {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$Quiet
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $rawOutput = & $Name @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output = @($rawOutput | ForEach-Object { $_.ToString() })
  if ($exitCode -ne 0) {
    $detail = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($detail)) {
      $detail = 'No command output was returned.'
    }
    throw "$Name failed with exit code $exitCode.`n$detail"
  }

  if (-not $Quiet -and $null -ne $output) {
    $output | ForEach-Object { Write-Output $_ }
  }
}

function Invoke-AzJson {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $rawOutput = & az @Arguments --only-show-errors --output json 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output = @($rawOutput | ForEach-Object { $_.ToString() })
  $text = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
  if ($exitCode -ne 0) {
    throw "az $($Arguments -join ' ') failed with exit code $exitCode.`n$text"
  }
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  try {
    return $text | ConvertFrom-Json
  } catch {
    throw "az $($Arguments -join ' ') returned invalid JSON.`n$text"
  }
}

function Invoke-AzText {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $rawOutput = & az @Arguments --only-show-errors --output tsv 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output = @($rawOutput | ForEach-Object { $_.ToString() })
  $text = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
  if ($exitCode -ne 0) {
    throw "az $($Arguments -join ' ') failed with exit code $exitCode.`n$text"
  }
  return $text.Trim()
}

function Get-DeploymentOutput {
  param(
    [Parameter(Mandatory)]$Deployment,
    [Parameter(Mandatory)][string]$Name
  )

  $property = $Deployment.properties.outputs.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value.value) {
    throw "Deployment output '$Name' was not returned."
  }
  return [string]$property.Value.value
}

function Invoke-WhatIf {
  param(
    [Parameter(Mandatory)][string]$Scope,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  Write-Output "Running $Scope what-if..."
  # Azure CLI renders what-if as a human-readable report even when --output
  # json is supplied, so success is validated by its exit code.
  Invoke-ExternalCommand -Name 'az' -Arguments $Arguments -Quiet
  Write-Output "$Scope what-if completed."
}

function Remove-LocalTestContainer {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & docker stop $localContainerName 2>$null | Out-Null
    & docker rm --force $localContainerName 2>$null | Out-Null
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Get-HttpResponse {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')]
    [string]$Method = 'GET',
    [string]$Body
  )

  $parameters = @{
    UseBasicParsing = $true
    Uri = $Uri
    Method = $Method
    TimeoutSec = 10
  }
  if ($PSBoundParameters.ContainsKey('Body')) {
    $parameters.Body = $Body
    $parameters.ContentType = 'application/json'
  }
  return Invoke-WebRequest @parameters
}

function Wait-ForPublicApplication {
  param([Parameter(Mandatory)][string]$BaseUrl)

  $attemptLimit = [Math]::Ceiling($PublicHealthTimeoutSeconds / 5)
  for ($attempt = 1; $attempt -le $attemptLimit; $attempt++) {
    try {
      $health = Get-HttpResponse -Uri "$BaseUrl/api/health"
      $root = Get-HttpResponse -Uri "$BaseUrl/"
      if (
        $health.StatusCode -eq 200 -and
        $health.Content -match '"status"\s*:\s*"ok"' -and
        $root.StatusCode -eq 200 -and
        $root.Content -match 'Sample Todo'
      ) {
        return @{
          Health = $health
          Root = $root
        }
      }
    } catch {
      if ($attempt -eq $attemptLimit) {
        throw "Public application did not become healthy within $PublicHealthTimeoutSeconds seconds. Last error: $($_.Exception.Message)"
      }
    }
    Start-Sleep -Seconds 5
  }

  throw "Public application did not become healthy within $PublicHealthTimeoutSeconds seconds."
}

function Wait-ForRevisionHealthy {
  param(
    [Parameter(Mandatory)][string]$ContainerAppName,
    [Parameter(Mandatory)][string]$RevisionName
  )

  $attemptLimit = [Math]::Ceiling($PublicHealthTimeoutSeconds / 5)
  for ($attempt = 1; $attempt -le $attemptLimit; $attempt++) {
    $revision = Invoke-AzJson -Arguments @(
      'containerapp', 'revision', 'show',
      '--name', $ContainerAppName,
      '--resource-group', $ResourceGroupName,
      '--revision', $RevisionName,
      '--subscription', $SubscriptionId
    )
    $runningState = [string]$revision.properties.runningState
    $healthState = [string]$revision.properties.healthState
    Write-Host "Revision state check $attempt/${attemptLimit}: running=$runningState health=$healthState"
    if ($runningState -like 'Running*' -and $healthState -eq 'Healthy') {
      return $revision
    }
    if ($runningState -in @('Failed', 'Deprovisioning', 'Deprovisioned')) {
      throw "Latest Container App revision entered terminal state '$runningState'."
    }
    if ($attempt -lt $attemptLimit) {
      Start-Sleep -Seconds 5
    }
  }

  throw "Latest Container App revision did not become healthy within $PublicHealthTimeoutSeconds seconds."
}

Write-Output "Checking local prerequisites..."
Assert-Command -Name 'az'
Assert-Command -Name 'docker'
Assert-Command -Name 'node'
Assert-Command -Name 'npm'
Invoke-ExternalCommand -Name 'docker' -Arguments @('info', '--format', '{{.ServerVersion}}') -Quiet

# Azure CLI uses the system code page for some Bicep messages. UTF-8 also handles
# Windows profiles whose paths contain non-ASCII characters.
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
try {
  Invoke-ExternalCommand -Name 'az' -Arguments @('bicep', 'version') -Quiet
} catch {
  Write-Output 'Azure CLI Bicep integration is not installed; installing it now...'
  Invoke-ExternalCommand -Name 'az' -Arguments @('bicep', 'install') -Quiet
  Invoke-ExternalCommand -Name 'az' -Arguments @('bicep', 'version') -Quiet
}

Write-Output "Validating Bicep templates..."
Invoke-ExternalCommand -Name 'az' -Arguments @('bicep', 'build', '--file', $mainTemplate, '--stdout') -Quiet
Invoke-ExternalCommand -Name 'az' -Arguments @('bicep', 'build', '--file', $workloadTemplate, '--stdout') -Quiet

Write-Output "Running application validation..."
Invoke-ExternalCommand -Name 'npm' -Arguments @('--prefix', $repoRoot, 'run', 'validate') -Quiet

Write-Output "Building the application image locally..."
Invoke-ExternalCommand -Name 'docker' -Arguments @('build', '--provenance=false', '--tag', $localImageTag, $repoRoot) -Quiet
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $localImageIdOutput = & docker image inspect $localImageTag --format '{{.Id}}' 2>&1
  $localImageIdExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
$localImageId = (($localImageIdOutput | ForEach-Object { $_.ToString() }) | Select-Object -Last 1).Trim()
if ($localImageIdExitCode -ne 0 -or $localImageId -notmatch '^sha256:[0-9a-f]+$') {
  throw "Could not read the local image ID for $localImageTag."
}
$imageDigestFragment = $localImageId.Substring(7, [Math]::Min(12, $localImageId.Length - 7))
$imageTag = "sha-$imageDigestFragment"
Write-Output "Local image tag: $localImageTag"
Write-Output "Immutable image tag: $imageTag"

if (@(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
  throw "Local port $LocalPort is already in use."
}

Write-Output "Verifying the local image on port $LocalPort..."
Remove-LocalTestContainer
$localContainerId = $null
try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $localContainerIdOutput = & docker run --detach --rm --name $localContainerName --publish "${LocalPort}:3001" $localImageTag 2>&1
    $localContainerExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $localContainerId = (($localContainerIdOutput | ForEach-Object { $_.ToString() }) | Select-Object -Last 1).Trim()
  if ($localContainerExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($localContainerId)) {
    throw "Could not start local image container."
  }

  $localResult = Wait-ForPublicApplication -BaseUrl "http://127.0.0.1:$LocalPort"
  Write-Output "Local health status: $($localResult.Health.StatusCode)"
  Write-Output "Local root status: $($localResult.Root.StatusCode)"
  Write-Output "Local UI marker found: $($localResult.Root.Content -match 'Sample Todo')"
} finally {
  Remove-LocalTestContainer
}

Write-Output "Selecting Azure subscription..."
Invoke-ExternalCommand -Name 'az' -Arguments @('account', 'set', '--subscription', $SubscriptionId) -Quiet
$accountId = Invoke-AzText -Arguments @('account', 'show', '--subscription', $SubscriptionId, '--query', 'id')
if ($accountId -ne $SubscriptionId) {
  throw "Azure CLI selected subscription '$accountId' instead of '$SubscriptionId'."
}

$resourceGroupOutput = $null
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$resourceGroupOutput = & az group show --name $ResourceGroupName --subscription $SubscriptionId --only-show-errors --output json 2>$null
$resourceGroupExists = $LASTEXITCODE -eq 0
$ErrorActionPreference = $previousErrorActionPreference
Write-Output "Resource group '$ResourceGroupName' exists before deployment: $resourceGroupExists"

$platformDeploymentName = "sampletodo-platform-$ResourceToken"
$platformWhatIfArguments = @(
  'deployment', 'sub', 'what-if',
  '--name', $platformDeploymentName,
  '--location', $Location,
  '--subscription', $SubscriptionId,
  '--template-file', $mainTemplate,
  '--parameters', "@$mainParameters"
)
Invoke-WhatIf -Scope 'Platform' -Arguments $platformWhatIfArguments

Write-Output "Deploying the resource group and platform resources..."
$platformDeployment = Invoke-AzJson -Arguments @(
  'deployment', 'sub', 'create',
  '--name', $platformDeploymentName,
  '--location', $Location,
  '--subscription', $SubscriptionId,
  '--template-file', $mainTemplate,
  '--parameters', "@$mainParameters"
)

$registryName = Get-DeploymentOutput -Deployment $platformDeployment -Name 'registryName'
$registryLoginServer = Get-DeploymentOutput -Deployment $platformDeployment -Name 'registryLoginServer'
$managedIdentityName = Get-DeploymentOutput -Deployment $platformDeployment -Name 'managedIdentityName'
$managedEnvironmentName = Get-DeploymentOutput -Deployment $platformDeployment -Name 'managedEnvironmentName'
$containerAppName = Get-DeploymentOutput -Deployment $platformDeployment -Name 'containerAppName'
$platformResourceToken = Get-DeploymentOutput -Deployment $platformDeployment -Name 'resourceToken'
$resourceGroupId = Get-DeploymentOutput -Deployment $platformDeployment -Name 'resourceGroupId'
Write-Output "Platform resource token: $platformResourceToken"
Write-Output "Resource group ID: $resourceGroupId"
Write-Output "Registry: $registryName ($registryLoginServer)"
Write-Output "Managed identity: $managedIdentityName"
Write-Output "Managed environment: $managedEnvironmentName"

$registry = Invoke-AzJson -Arguments @(
  'acr', 'show',
  '--name', $registryName,
  '--resource-group', $ResourceGroupName,
  '--subscription', $SubscriptionId
)
$registryId = [string]$registry.id
Write-Output "Registry provisioning state: $($registry.provisioningState)"
if ($registry.provisioningState -ne 'Succeeded') {
  throw "Registry provisioning state is '$($registry.provisioningState)'."
}
if ($registry.loginServer -ne $registryLoginServer) {
  $registryLoginServer = [string]$registry.loginServer
}

$identity = Invoke-AzJson -Arguments @(
  'identity', 'show',
  '--name', $managedIdentityName,
  '--resource-group', $ResourceGroupName,
  '--subscription', $SubscriptionId
)
$identityPrincipalId = [string]$identity.principalId
Write-Output "Managed identity state: Succeeded (resource exists)"

$roleAssignmentId = Get-DeploymentOutput -Deployment $platformDeployment -Name 'acrPullRoleAssignmentId'
$roleAssignments = @(Invoke-AzJson -Arguments @(
  'role', 'assignment', 'list',
  '--scope', $registryId,
  '--assignee-object-id', $identityPrincipalId,
  '--role', 'AcrPull'
))
$roleAssignment = @($roleAssignments | Where-Object { $_.id -eq $roleAssignmentId })
if ($roleAssignment.Count -ne 1) {
  throw "The expected AcrPull role assignment was not found at the registry scope."
}
Write-Output "AcrPull role assignment: $($roleAssignment[0].id)"

Write-Output "Logging Docker into the registry with Azure CLI..."
Invoke-ExternalCommand -Name 'az' -Arguments @(
  'acr', 'login',
  '--name', $registryName,
  '--subscription', $SubscriptionId,
  '--only-show-errors'
)

$remoteImage = "${registryLoginServer}/${ImageRepository}:${imageTag}"
Invoke-ExternalCommand -Name 'docker' -Arguments @('tag', $localImageTag, $remoteImage) -Quiet
Write-Output "Pushing $remoteImage..."
Invoke-ExternalCommand -Name 'docker' -Arguments @('push', $remoteImage)
$pushedDigest = Invoke-AzText -Arguments @(
  'acr', 'repository', 'show',
  '--name', $registryName,
  '--subscription', $SubscriptionId,
  '--image', "${ImageRepository}:${imageTag}",
  '--query', 'digest'
)
if ($pushedDigest -notmatch '^sha256:[0-9a-f]+$') {
  throw "The pushed image digest was not returned by Azure Container Registry."
}
Write-Output "Pushed image digest: $pushedDigest"

# RBAC propagation can lag the successful role-assignment deployment.
Start-Sleep -Seconds 20

$workloadDeploymentName = "sampletodo-workload-$ResourceToken"
$workloadParameters = @(
  "location=$Location",
  "environmentName=$EnvironmentName",
  "registryName=$registryName",
  "managedIdentityName=$managedIdentityName",
  "managedEnvironmentName=$managedEnvironmentName",
  "image=$remoteImage"
)
$workloadWhatIfArguments = @(
  'deployment', 'group', 'what-if',
  '--name', $workloadDeploymentName,
  '--resource-group', $ResourceGroupName,
  '--subscription', $SubscriptionId,
  '--template-file', $workloadTemplate,
  '--parameters'
) + $workloadParameters
Invoke-WhatIf -Scope 'Workload' -Arguments $workloadWhatIfArguments

Write-Output "Deploying the application workload..."
$workloadDeployment = Invoke-AzJson -Arguments (@(
  'deployment', 'group', 'create',
  '--name', $workloadDeploymentName,
  '--resource-group', $ResourceGroupName,
  '--subscription', $SubscriptionId,
  '--template-file', $workloadTemplate,
  '--parameters'
) + $workloadParameters)

$deployedFqdn = Get-DeploymentOutput -Deployment $workloadDeployment -Name 'fqdn'
$deployedImage = Get-DeploymentOutput -Deployment $workloadDeployment -Name 'image'
Write-Output "Deployed image: $deployedImage"
Write-Output "Container App FQDN: $deployedFqdn"

$containerApp = Invoke-AzJson -Arguments @(
  'containerapp', 'show',
  '--name', $containerAppName,
  '--resource-group', $ResourceGroupName,
  '--subscription', $SubscriptionId
)
$containerAppId = [string]$containerApp.id
$latestRevisionName = [string]$containerApp.properties.latestRevisionName
Write-Output "Container App provisioning state: $($containerApp.properties.provisioningState)"
Write-Output "Container App ID: $containerAppId"
Write-Output "Latest revision: $latestRevisionName"
if ($containerApp.properties.provisioningState -ne 'Succeeded') {
  throw "Container App provisioning state is '$($containerApp.properties.provisioningState)'."
}
if ($containerApp.properties.template.containers[0].image -ne $remoteImage) {
  throw "Container App is not configured with the pushed application image."
}

$revision = Wait-ForRevisionHealthy -ContainerAppName $containerAppName -RevisionName $latestRevisionName
Write-Output "Revision provisioning state: $($revision.properties.provisioningState)"
Write-Output "Revision running state: $($revision.properties.runningState)"
Write-Output "Revision health state: $($revision.properties.healthState)"

Write-Output "Reading Container App logs..."
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $logRawOutput = & az containerapp logs show --name $containerAppName --resource-group $ResourceGroupName --subscription $SubscriptionId --tail 50 --type console --follow false --only-show-errors 2>&1
  $logExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
$logOutput = @($logRawOutput | ForEach-Object { $_.ToString() })
if ($logExitCode -ne 0) {
  $logDetail = ($logOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
  throw "Container App log retrieval failed.`n$logDetail"
}
if ($null -ne $logOutput) {
  $logOutput | Select-Object -Last 20 | ForEach-Object { Write-Output $_ }
}

$publicBaseUrl = "https://$deployedFqdn"
$publicResult = Wait-ForPublicApplication -BaseUrl $publicBaseUrl
Write-Output "Public root status: $($publicResult.Root.StatusCode)"
Write-Output "Public health status: $($publicResult.Health.StatusCode)"
Write-Output "Public UI marker found: $($publicResult.Root.Content -match 'Sample Todo')"

Write-Output "Running public CRUD smoke test..."
$createResponse = Get-HttpResponse -Uri "$publicBaseUrl/api/todos" -Method 'POST' -Body (@{ title = "Azure smoke $ResourceToken" } | ConvertTo-Json -Compress)
if ($createResponse.StatusCode -ne 201) {
  throw "CRUD smoke POST returned HTTP $($createResponse.StatusCode)."
}
$createdTodo = $createResponse.Content | ConvertFrom-Json
$todoId = [string]$createdTodo.todo.id
if ([string]::IsNullOrWhiteSpace($todoId)) {
  throw 'CRUD smoke POST did not return a todo ID.'
}

$listResponse = Get-HttpResponse -Uri "$publicBaseUrl/api/todos"
$listedTodos = $listResponse.Content | ConvertFrom-Json
if (@($listedTodos.todos | Where-Object { $_.id -eq $todoId }).Count -ne 1) {
  throw 'CRUD smoke GET did not return the created todo.'
}

$patchResponse = Get-HttpResponse -Uri "$publicBaseUrl/api/todos/$todoId" -Method 'PATCH' -Body (@{ completed = $true } | ConvertTo-Json -Compress)
if ($patchResponse.StatusCode -ne 200) {
  throw "CRUD smoke PATCH returned HTTP $($patchResponse.StatusCode)."
}

$deleteResponse = Get-HttpResponse -Uri "$publicBaseUrl/api/todos/$todoId" -Method 'DELETE'
if ($deleteResponse.StatusCode -ne 204) {
  throw "CRUD smoke DELETE returned HTTP $($deleteResponse.StatusCode)."
}
Write-Output "CRUD smoke result: POST=201 GET=200 PATCH=200 DELETE=204"

$resourceGroup = Invoke-AzJson -Arguments @(
  'group', 'show',
  '--name', $ResourceGroupName,
  '--subscription', $SubscriptionId
)
Write-Output "Resource group provisioning state: $($resourceGroup.properties.provisioningState)"
Write-Output "Resource group remains deployed: $($null -ne $resourceGroup.id)"
Write-Output "Portal resource-group URL: https://portal.azure.com/#@/resource$($resourceGroup.id)/overview"
Write-Output "Public URL: $publicBaseUrl"
Write-Output "Image tag: $imageTag"
Write-Output "Image digest: $pushedDigest"
Write-Output "Deployment completed successfully."
