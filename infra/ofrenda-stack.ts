// El stack del altar: una tabla, un bucket privado, tres Lambdas y una REST API.
// Sigue .kiro/specs/ofrenda/design.md.

import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import { Construct } from 'constructs'

export class OfrendaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // La llave no se toca: un cambio aquí puede borrar los elementos del altar.
    const tabla = new dynamodb.Table(this, 'Elementos', {
      tableName: 'ofrenda-elementos',
      partitionKey: { name: 'altarId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Bucket privado: las imágenes solo se ven con una URL firmada.
    const bucket = new s3.Bucket(this, 'Imagenes', {
      bucketName: `ofrenda-imagenes-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    })

    // Lambdas en JavaScript plano: Code.fromAsset empaqueta la carpeta lambda/.
    const comun = {
      runtime: lambda.Runtime.NODEJS_24_X,
      code: lambda.Code.fromAsset('lambda'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
    }

    const listar = new lambda.Function(this, 'Listar', {
      ...comun,
      handler: 'listar.handler',
      environment: { TABLA: tabla.tableName },
    })
    const agregar = new lambda.Function(this, 'Agregar', {
      ...comun,
      handler: 'agregar.handler',
      environment: { TABLA: tabla.tableName },
    })
    const subir = new lambda.Function(this, 'Subir', {
      ...comun,
      handler: 'subir.handler',
      environment: { BUCKET: bucket.bucketName },
    })

    // Permisos acotados a la tabla o al bucket concretos.
    tabla.grantReadData(listar)
    tabla.grantReadWriteData(agregar)
    bucket.grantPut(subir)
    bucket.grantRead(subir)

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'ofrenda-api',
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST'],
        allowHeaders: ['Content-Type'],
      },
    })

    const elements = api.root.addResource('elements')
    elements.addMethod('GET', new apigateway.LambdaIntegration(listar))
    elements.addMethod('POST', new apigateway.LambdaIntegration(agregar))

    const uploads = api.root.addResource('uploads')
    uploads.addMethod('POST', new apigateway.LambdaIntegration(subir))
    uploads.addResource('{proxy+}').addMethod('GET', new apigateway.LambdaIntegration(subir))

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url })
  }
}
