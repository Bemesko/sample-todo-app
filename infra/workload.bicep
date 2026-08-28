targetScope = 'resourceGroup'

@description('Azure region where the existing Container Apps environment is deployed.')
param location string

@description('Stable environment name used in deterministic resource naming.')
param environmentName string = 'sampletodo'

@description('Existing Azure Container Registry name.')
param registryName string

@description('Existing user-assigned managed identity name.')
param managedIdentityName string

@description('Existing Container Apps managed environment name.')
param managedEnvironmentName string

@description('Container image repository name without a tag or digest.')
@minLength(1)
param imageRepository string

@description('Required 64-character lowercase SHA-256 digest without the sha256: prefix. The deployment runner validates the hexadecimal format before deployment.')
@minLength(64)
@maxLength(64)
param imageDigest string

var resourceToken = uniqueString(subscription().id, resourceGroup().id, location, environmentName)
var containerAppName = 'azapp${resourceToken}'
var image = '${registry.properties.loginServer}/${imageRepository}@sha256:${imageDigest}'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: registryName
}

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: managedIdentityName
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: managedEnvironmentName
}

resource containerApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registry.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 3001
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: [
            '*'
          ]
          allowedMethods: [
            'GET'
            'POST'
            'PATCH'
            'DELETE'
            'OPTIONS'
          ]
          allowedHeaders: [
            'Content-Type'
          ]
          exposeHeaders: []
          maxAge: 3600
          allowCredentials: false
        }
      }
    }
    template: {
      containers: [
        {
          name: 'app'
          image: image
          env: [
            {
              name: 'PORT'
              value: '3001'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/api/health'
                port: 3001
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 30
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 3001
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 3001
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
              successThreshold: 1
            }
          ]
        }
      ]
      scale: {
        // Todo state is in memory; multiple replicas would diverge.
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output containerAppName string = containerApp.name
output fqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppId string = containerApp.id
output image string = image
