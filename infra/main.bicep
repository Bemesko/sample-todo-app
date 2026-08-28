targetScope = 'subscription'

@description('Azure region for the resource group and workload resources.')
param location string = 'brazilsouth'

@description('Resource group that contains the sample Todo platform and application.')
param resourceGroupName string = 'azsampletodo'

@description('Stable environment name used in deterministic resource naming.')
param environmentName string = 'sampletodo'

var resourceToken = uniqueString(subscription().id, location, environmentName)

resource resourceGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
}

module platform 'modules/platform.bicep' = {
  name: 'platform${resourceToken}'
  scope: resourceGroup
  params: {
    environmentName: environmentName
    location: location
  }
}

output resourceGroupId string = resourceGroup.id
output resourceToken string = resourceToken
output registryName string = platform.outputs.registryName
output registryLoginServer string = platform.outputs.registryLoginServer
output managedIdentityName string = platform.outputs.managedIdentityName
output managedEnvironmentName string = platform.outputs.managedEnvironmentName
output containerAppName string = platform.outputs.containerAppName
output acrPullRoleAssignmentId string = platform.outputs.acrPullRoleAssignmentId
