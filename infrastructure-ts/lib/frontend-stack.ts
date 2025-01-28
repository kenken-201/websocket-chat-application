// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { WebSocketApi } from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { CacheCookieBehavior, CacheHeaderBehavior, CachePolicy, CacheQueryStringBehavior, SecurityPolicyProtocol, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { OAuthScope, UserPool } from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AnyPrincipal, Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { ParameterTier, StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface FrontendProps extends StackProps {
  restApi: RestApi;
  websocketApi: WebSocketApi;
  cognitoUserPoolId: string;
  cognitoDomainPrefix: string;
}

/**
 * infrastructure-ts\lib\frontend-stack.ts は、WebSocketチャットアプリケーションの
 * フロントエンドインフラストラクチャを管理するCDKスタックを定義しています
 * このスタックは、静的コンテンツ配信（フロントエンド）、API統合（RESTとWebSocket）、
 * およびCognitoを使用したユーザー認証を処理するためのAWSリソースをプロビジョニングします
 */
export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props?: FrontendProps) {
    super(scope, id, props);

    const cloudfrontOAI = new cloudfront.OriginAccessIdentity(this, 'cloudfront-OAI', { comment: `OAI for ${id}` });

    // Content bucket
    /**
     * 静的コンテンツのホスティング
     * S3バケット: 
     * フロントエンドの静的アセット（HTML、JavaScript、CSS）を
     * ホストするためのセキュアなS3バケットを作成します
     *   パブリックアクセスをブロックします（BlockPublicAccess.BLOCK_ALL）
     * オブジェクトは s3.BucketEncryption.S3_MANAGED を使用して暗号化されます
     * CloudFront オリジンアクセスID (OAI) と関連付けられ、CloudFrontからのみバケットにアクセス可能にします
     * BucketDeployment を使用して、事前にビルドされた
     * 静的ファイル（../UI/dist/websocket-chat）をこのS3バケットにデプロイします
     * HTTPS経由のセキュアな通信を強制し、不セキュアな通信経由のアクションを拒否するポリシーを設定します
     */
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
      autoDeleteObjects: true, // NOT recommended for production use
    });
    siteBucket.addToResourcePolicy(new PolicyStatement({
      effect: Effect.DENY,
      principals: [
        new AnyPrincipal(),
      ],
      actions: [
        "s3:*"
      ],
      resources: [siteBucket.bucketArn],
      conditions: {
        "Bool": { "aws:SecureTransport": "false" },
      },
    }));

    // *** Log bucket for cloudfront access logging
    // *** UNCOMMENT TO ENABLE ACCESS LOGGING
    // const logBucket = new s3.Bucket(this, 'LogBucket', {
    //   publicReadAccess: false,
    //   encryption: s3.BucketEncryption.S3_MANAGED,
    //   blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    //   removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
    //   autoDeleteObjects: true, // NOT recommended for production use
    // });
    // logBucket.addToResourcePolicy(new PolicyStatement({
    //   effect: Effect.DENY,
    //   principals: [
    //     new AnyPrincipal(),
    //   ],
    //   actions: [
    //     "s3:*"
    //   ],
    //   resources: [logBucket.bucketArn],
    //   conditions: {
    //     "Bool": { "aws:SecureTransport": "false" },
    //   },
    // }));

    // Grant access to cloudfront
    /**
     * CloudFrontによるコンテンツ配信
     * CloudFrontディストリビューション: コンテンツ配信を高速化し、セキュリティポリシーを適用します
     *   デフォルトの動作では、リクエストをS3バケットにルーティングし、キャッシュと圧縮を適用します
     *   カスタムキャッシュポリシーでは、認証を正しく処理するために
     *   Authorization ヘッダーをREST APIに転送します
     *   カスタムエラーレスポンス（例: 404エラーは/error.htmlにリダイレクト）を設定します
     * 特別なルーティング:
     *   REST APIリクエスト（例: api/*）はAPI Gateway RESTエンドポイント（props.restApi）にルーティングします
     *   WebSocket APIリクエスト（例: wss/*）はWebSocketエンドポイント（props.websocketApi）に
     *   ルーティングし、適切なリクエストヘッダーを転送します
     * 
     * 
     * 他のファイル・ディレクトリとの関連性
     * infrastructure-ts\bin\serverless-chat.ts
     *   これはCDKアプリケーションのエントリーポイントです
     *   このFrontendStackを他のスタック（例: ObservabilityStack, BackendStack）と
     *   共にインスタンス化し、必要なプロパティを渡します
     *   FrontendStackは以下を利用します:
     *    他のスタック（例: BackendStack）で作成されたRestApiおよびWebSocketApiオブジェクト
     *    認証セットアップからのCognitoユーザープールIDおよびドメインプレフィックス
     * infrastructure-ts\lib内の他のスタック
     *   1. backend-stack.ts:
     *    FrontendStackが利用するAPI（RESTおよびWebSocket）を提供します
     *    RESTおよびWebSocket APIはCloudFrontの動作を設定するために
     *    FrontendStackへプロパティとして渡されます
     *   2. observability-stack.ts:
     *    主要なアプリケーションメトリクスの監視を追加します
     *    FrontendStackと直接的な接続はありませんが、アプリケーション全体の運用可視性を提供します
     * resources/ディレクトリ
     *   通常、Lambda関数コードやテンプレートなどのサポートファイルを含みます
     *   FrontendStackには直接的な依存関係はありませんが、BackendStack内のリソースと
     *   間接的に連携する可能性があります
     * 
     * 次のステップ: 確認すべきファイル・ディレクトリ
     * backend-stack.ts
     *   フロントエンドで使用されるAPI（RestApiとWebSocketApi）をプロビジョニングします
     *   バックエンドAPIの設計を理解することで、フロントエンドとの連携が明確になります
     * bin/serverless-chat.ts
     *   CDKアプリケーションのエントリーポイントであり、全てのスタックを初期化します
     *   スタック間の連携を理解することで、プロジェクト全体のフローが把握できます
     * フロントエンドコード（../UI/dist/websocket-chat）
     *   事前ビルドされていますが、ソースコード（利用可能な場合）を確認することで、
     *   バックエンドやCognitoとの統合が明らかになります
     * resources/ディレクトリ
     *   Lambda関数やその他のカスタム実装がある場合、バックエンドの機能を補強する内容を確認します
     */
    siteBucket.addToResourcePolicy(new PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [siteBucket.arnForObjects('*')],
      principals: [new iam.CanonicalUserPrincipal(cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
    }));
    new CfnOutput(this, 'Bucket', { value: siteBucket.bucketName });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: { // Default to S3 bucket
        origin: new origins.S3Origin(siteBucket, { originAccessIdentity: cloudfrontOAI }),
        compress: true,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      defaultRootObject: 'index.html',
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [{ responsePagePath: '/error.html', httpStatus: 404, responseHttpStatus: 404 },
      {
        httpStatus: 403,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.minutes(1),
      }],
      // *** UNCOMMENT TO ENABLE ACCESS LOGGING
      //logBucket: logBucket,
      //logFilePrefix: 'distribution-access-logs/',
      //logIncludesCookies: true
    });
    NagSuppressions.addResourceSuppressions(
      distribution,
      [
        {
          id: 'AwsSolutions-CFR3',
          reason:
            "Access logging is disabled to save cost. It can be re-enabled by uncommenting the code above."
        },
        {
          id: 'AwsSolutions-CFR4',
          reason:
            "TLSv1.1 or TLSv1.2 can be only enforced using a custom certificate with a custom domain alias."
        },
      ],
      true
    );


    // Custom Cloudfront cache policy to forward Authorization header
    const cachePolicy = new CachePolicy(this, 'CachePolicy', {
      headerBehavior: CacheHeaderBehavior.allowList(
        'Authorization',
      ),
      cookieBehavior: CacheCookieBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
      minTtl: Duration.seconds(1),
      maxTtl: Duration.seconds(10),
      defaultTtl: Duration.seconds(5),
    })

    // REST API behaviour matched to "api/*" path
    distribution.addBehavior('api/*', new origins.HttpOrigin(`${props?.restApi.restApiId}.execute-api.${Stack.of(this).region}.amazonaws.com`, {
      originPath: `/${props?.restApi.deploymentStage.stageName}`
    }), {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cachePolicy,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      compress: false
    });

    const wsOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, "webSocketPolicy", {
      originRequestPolicyName: "webSocketPolicy",
      comment: "A default WebSocket policy",
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList("Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Protocol", "Sec-WebSocket-Accept"),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.none(),
    });

    // Websocket API behaviour matched to "wss/*" path
    distribution.addBehavior('wss/*', new origins.HttpOrigin(`${props?.websocketApi.apiId}.execute-api.${Stack.of(this).region}.amazonaws.com`, {
      originPath: `/`
    }), {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: wsOriginRequestPolicy,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY
    });

    // Upload the pre-compiled frontend static files
    new BucketDeployment(this, `DeployApp-${new Date().toISOString()}`, {
      sources: [Source.asset("../UI/dist/websocket-chat")],
      destinationBucket: siteBucket,
      distribution: distribution,
      distributionPaths: ['/'],
    });

    // Retrieving Cognito Userpool from existing resource - resolving circular stack dependency
    /**
     * Cognitoを使用したユーザー認証
     * Cognitoユーザープール統合: ユーザー認証と認可を処理します
     *   既存のCognitoユーザープール（props.cognitoUserPoolId）を使用し、
     *   OAuth 2.0フロー（implicitCodeGrant）を持つアプリクライアントを作成します
     * 認証フロー用のコールバックURLとログアウトURLをCloudFrontディストリビューションに設定します
     * Cognitoドメインはカスタムドメインプレフィックス（props.cognitoDomainPrefix）で設定されます
     * CognitoのサインインURLをクライアント側で使用できるよう出力します
     */
    const userPool = UserPool.fromUserPoolId(this, "UserPool", props?.cognitoUserPoolId!);
    const appClient = userPool.addClient('websocket-frontend', {
      oAuth: {
        flows: {
          authorizationCodeGrant: false,
          implicitCodeGrant: true // return ID/Access tokens in returnURL
        },
        scopes: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL],
        callbackUrls: [`https://${distribution.distributionDomainName}/callback`, "http://localhost:4200/callback"],
        logoutUrls: [`https://${distribution.distributionDomainName}/login`, "http://localhost:4200/callback"],
      },

      idTokenValidity: Duration.minutes(720),
    });

    // Generate a cognito app client with a returnURL pointing to the Cloudfront distribution url
    const domain = userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: props?.cognitoDomainPrefix!
      }
    });

    const cognitoSignInUrl = domain!.signInUrl(appClient!, {
      redirectUri: `https://${distribution.distributionDomainName}/callback`, // must be a URL configured under 'callbackUrls' with the client
    });

    /**
     * SSMでの設定パラメータ管理
     * AWS Systems Manager Parameter Storeに重要な設定情報を保存します
     *   CognitoサインインURL
     *   WebSocketエンドポイントURL（例: wss://{CloudFrontDomainName}/wss/）
     *   CognitoクライアントID
     */
    const signinUrlParameter = new StringParameter(this, 'CognitoSigninURLParameter', {
      allowedPattern: '.*',
      description: 'Cognito Singin URL',
      parameterName: '/prod/cognito/signinurl',
      stringValue: cognitoSignInUrl,
      tier: ParameterTier.STANDARD,
    });

    const websocketUrlParameter = new StringParameter(this, 'WebsocketURLParameter', {
      allowedPattern: '.*',
      description: 'Websocket API URL',
      parameterName: '/prod/websocket/url',
      stringValue: `wss://${distribution.distributionDomainName}/wss/`,
      tier: ParameterTier.STANDARD,
    });

    const clientIdParameter = new StringParameter(this, 'CognitoClientIdParameter', {
      allowedPattern: '.*',
      description: 'Cognito client id',
      parameterName: '/prod/cognito/clientid',
      stringValue: appClient?.userPoolClientId!,
      tier: ParameterTier.STANDARD,
    });

    /**
     * 以下のような主要な情報を出力します
     *   CloudFrontディストリビューションURLとID
     *   フロントエンド認証時に使用するCognitoサインインURL
     */
    new CfnOutput(this, 'cognitoSigninURL', {
      value: cognitoSignInUrl,
      description: 'SignIn URL for Cognito Userpool',
      exportName: 'cognitoSigninURL',
    });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'DistributionURL', { value: distribution.distributionDomainName });
  }
};
