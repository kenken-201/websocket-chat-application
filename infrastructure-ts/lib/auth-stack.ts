// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';


/*
* ユーザー認証基盤の構築
*   Amazon Cognitoを使用して、ユーザー認証（サインイン・サインアップ）を行うためのユーザープールを作成します。
*   フロントエンドやAPIが認証済みのユーザーのみアクセスできるようにします。
* アプリケーションクライアントの設定
*   フロントエンドやモバイルアプリから認証リクエストを行うためのクライアント（User Pool Client）を設定します。
* カスタムドメインやトリガーの設定（オプション）
*   Cognitoのホストされたログインページを使用する場合は、カスタムドメインを設定します。
*   ユーザー登録後に追加処理が必要な場合は、Lambdaトリガーを定義することもあります。
*/
export class AuthenticationStack extends Stack {

  readonly serverlessChatUserPool: cognito.UserPool;
  readonly cognitoUserPoolId: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // For this sample project, we just want users to be able to sign up and login instantly.
    // !!! WARNING !!! - do NOT use it in production! 
    // Add neccessary security measures, like email and multi-factor authentication.
    const autoVerifyFunction = new Function(this, 'lambda-function', {
      runtime: Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      handler: 'index.handler',
      code: Code.fromInline(`exports.handler = (event, context, callback) => {
        // Autoconfirm user
        event.response.autoConfirmUser = true;
        // Return to Amazon Cognito
        callback(null, event);
        };`)
    });

    // ユーザープールの作成
    this.serverlessChatUserPool = new cognito.UserPool(this, 'ServerlessChatUserPool', {
      selfSignUpEnabled: true,
      autoVerify: { email: true, phone: true }, // メールアドレス,電話番号の自動検証
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      signInAliases: {
        username: true,
        email: true,
      },
      lambdaTriggers: {
        preSignUp: autoVerifyFunction
      }
    });
    NagSuppressions.addResourceSuppressions(
      this.serverlessChatUserPool,
      [
        {
          id: 'AwsSolutions-COG3',
          reason:
            "AdvancedSecurityMode is not available yet in the CDK construct. See: https://github.com/aws/aws-cdk/pull/17923"
        }
      ],
      true
    );

    this.cognitoUserPoolId = this.serverlessChatUserPool.userPoolId;
  }
};