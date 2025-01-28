// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { PolicyDocument } from 'aws-lambda';

/**
 * COGNITO_USER_POOL_ID: 認証に使用する Cognito ユーザープールの ID
 * SSM (AWS Systems Manager Parameter Store):
 *   /prod/cognito/clientid パラメータから Cognito のクライアント ID を取得
 * Logger と Tracer:
 *   ログ記録や分散トレースを追加し、デバッグや監視を容易にする
 */
const { COGNITO_USER_POOL_ID, LOG_LEVEL } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ssm = tracer.captureAWSClient(new AWS.SSM());

/**
 * このファイルは、WebSocket API の認証処理を担う AWS Lambda 関数の実装です
 * WebSocket 接続時に呼び出され、Cognito のトークンを検証することで、
 * 接続リクエストが正当なものかどうかを判定し、アクセスを許可または拒否する役割を果たします
 * 
 * 機能概要
 * 目的:
 *   WebSocket クライアントが送信した認証トークン（Cookie 内の Cognito ID トークン）
 *   が有効であるかを確認し、接続リクエストを許可（Allow）または拒否（Deny）する
 * 入力: WebSocket 接続リクエストのイベントデータ（event）
 * 出力: AWS Lambda 認証の IAM ポリシー（Allow または Deny）
 * 
 * 
 * 他のファイルやディレクトリとの関係性
 * 1. infrastructure-ts/bin/serverless-chat.ts
 *   役割: プロジェクトのエントリーポイントとして、WebSocket のスタックを初期化
 *   関係性: authorizer.ts を WebSocket API の認証プロセスに組み込む
 * 2. infrastructure-ts/lib/WebSocketApiStack.ts
 *   役割: WebSocket API のリソース構築（connect、disconnect、およびカスタムルート）
 *   関係性: authorizer.ts が認証処理として設定される
 * 3. DynamoDB 接続テーブル
 *   役割: WebSocket クライアントの接続情報を保存
 *   関係性: 認証が成功したユーザーが接続時にこのテーブルに保存される
 * 
 * 
 * プロジェクト全体の流れ
 * 1. WebSocket クライアントの接続リクエスト:
 *   クライアントが WebSocket 接続リクエストを送信
 * 2. 認証処理 (authorizer.ts):
 *   トークンが検証され、許可（Allow）または拒否（Deny）のポリシーが生成される
 * 3. 接続ハンドラー:
 *   認証が成功すると、接続ハンドラーが DynamoDB テーブルにユーザーの接続情報を保存
 * 4. メッセージ送信処理:
 *   認証されたクライアント間でメッセージの送受信が行われる
 */
class Lambda implements LambdaInterface {
    @tracer.captureLambdaHandler()
    public async handler(event:any, context: any): Promise<any> {

        logger.addContext(context);
        logger.debug(JSON.stringify(event));
        logger.debug(JSON.stringify(context));

        // リクエストヘッダー内の Cookie からトークンを抽出
        // Cookie が存在しない場合やフォーマットが異なる場合、エラーが発生する可能性がある
        var token = event.headers["Cookie"].split('=')[1];
        
        // SSM パラメータストアからクライアント ID を取得（暗号化されている場合、復号化も実行）
        // トークン検証時に使用するクライアント ID を動的に取得
        let cognitoClientIdParameter = await ssm.getParameter({ Name: '/prod/cognito/clientid', WithDecryption: true }).promise();
        logger.debug("Cognito clientId:" + JSON.stringify(cognitoClientIdParameter));
    
        try {
            // CognitoJwtVerifier:
            //   AWS Cognito が発行した JWT トークンを検証するライブラリ
            //   userPoolId と clientId を指定することでトークンの発行元を特定
            let cognitoVerifier = CognitoJwtVerifier.create({
              userPoolId: COGNITO_USER_POOL_ID!,
              tokenUse: "id",
              clientId: cognitoClientIdParameter.Parameter.Value
            });

            // トークンが有効であれば、トークンの内容が verifiedToken として返される
            const verifiedToken = await cognitoVerifier.verify(token);
            logger.debug("Token is valid. :", verifiedToken);
            // 検証成功時間にトークンの内容を元に、IAM ポリシーを生成してアクセスを許可
            return this.generateAllow(verifiedToken["cognito:username"], event.methodArn);
      
          } catch (err: any) {
            logger.debug("Error during token validation: ", err);
            // 検証失敗時、接続を拒否するIAMポリシーを生成
            return this.generateDeny('default', event.methodArn);
        }

        //This code path should never execute - but if it is - Deny access
        return this.generateDeny('default', event.methodArn);
    }

    // Helper function to generate an IAM policy
    generatePolicy(principalId: any, effect: any, resource: any) {
        // Required output:
        var authResponse:any = {
            principalId: principalId
        };
        if (effect && resource) {
            let policyDocument: PolicyDocument = ({
                Version: '2012-10-17', // default version
                Statement: []
            });

            /**
             * Action: execute-api:Invoke（API の呼び出しを許可または拒否）
             * Effect: 許可（Allow）または拒否（Deny）
             * Resource: WebSocket API メソッドの ARN
             */
            var statementOne = {
                Action: 'execute-api:Invoke', // default action
                Effect: effect,
                Resource: resource,
            };
            policyDocument.Statement[0] = statementOne;
            authResponse.policyDocument = policyDocument;
        }

        // Optional output with custom properties of the String, Number or Boolean type.
        authResponse.context = {
            "customerId": principalId
        };
        return authResponse;
    }

    generateAllow(principalId: any, resource: any) {
        return this.generatePolicy(principalId, 'Allow', resource);
    }

    generateDeny(principalId:any, resource:any) {
        return this.generatePolicy(principalId, 'Deny', resource);
    }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
