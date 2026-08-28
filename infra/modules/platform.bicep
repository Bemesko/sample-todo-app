targetScope = 'resourceGroup'

@description('Azure region for the platform resources.')
param location string

@description('Stable environment name used in deterministic resource naming.')
param environmentName string

@description('Optional existing Azure Monitor action group resource ID for the Container Apps log alert.')
param alertActionGroupId string = ''

var resourceToken = uniqueString(subscription().id, resourceGroup().id, location, environmentName)
var registryName = 'azacr${resourceToken}'
var logAnalyticsName = 'azlog${resourceToken}'
var managedIdentityName = 'azid${resourceToken}'
var managedEnvironmentName = 'azenv${resourceToken}'
var containerAppName = 'azapp${resourceToken}'
var alertRuleName = 'azalert${resourceToken}'
var acrPullRoleDefinitionId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: registryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    // The registry requires authenticated pulls and does not expose admin credentials.
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: managedIdentityName
  location: location
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, managedIdentity.id, acrPullRoleDefinitionId)
  scope: registry
  properties: {
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      acrPullRoleDefinitionId
    )
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: managedEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource logAlert 'Microsoft.Insights/scheduledQueryRules@2025-01-01-preview' = {
  name: alertRuleName
  location: location
  kind: 'LogAlert'
  properties: {
    displayName: 'Sample Todo HTTP 5xx responses'
    description: 'Alerts when the sample Todo Container App emits an HTTP 5xx response.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [
      logAnalytics.id
    ]
    criteria: {
      allOf: [
        {
          query: format('''
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == '{0}'
| extend telemetry = parse_json(Log_s)
| where tostring(telemetry.event) == 'http.request'
| where toint(tostring(telemetry.status)) >= 500
| summarize ErrorCount = count() by bin(TimeGenerated, 5m)
''', containerAppName)
          metricMeasureColumn: 'ErrorCount'
          timeAggregation: 'Total'
          operator: 'GreaterThan'
          threshold: 0
          dimensions: []
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    // The custom table can take time to appear after the first Container App log.
    skipQueryValidation: true
    actions: {
      // An empty list intentionally creates the rule without notifications.
      actionGroups: empty(alertActionGroupId) ? [] : [
        alertActionGroupId
      ]
    }
  }
}

output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output managedIdentityName string = managedIdentity.name
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
output managedEnvironmentName string = managedEnvironment.name
output containerAppName string = containerAppName
output acrPullRoleAssignmentId string = acrPullRoleAssignment.id
output alertRuleName string = logAlert.name
output alertRuleId string = logAlert.id
