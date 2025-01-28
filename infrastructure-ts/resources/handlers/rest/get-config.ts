// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * LOG_LEVEL: ログの詳細度を制御
 * Logger: AWS Lambda Powertools のロガーを使用してログを管理
 * Tracer: AWS X-Ray を利用してトレーシングを設定
 * SSM (AWS Systems Manager Parameter Store):
 *   構成データを安全に管理し、API 経由で取得するためのクライアント
 */
const { LOG_LEVEL } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ssm = tracer.captureAWSClient(new AWS.SSM());

/**
 * このファイルは、REST API の /config エンドポイントの GET リクエストを処理する AWS Lambda ハンドラーの実装です
 * このハンドラーは、アプリケーションのフロントエンドで使用する
 * 構成情報（API URL、WebSocket URL、Cognito のログイン URL）を返します
 * 
 * 機能概要
 *   目的: 構成情報（api_url、broadcast_url、login_url）を JSON フォーマットでクライアントに提供
 *   入力: API Gateway 経由で受け取る GET リクエスト
 *   出力: Cognito のログイン URL、WebSocket URL などを含む設定データ
 * 
 * 
 * 他のディレクトリやファイルとの関係性
 * infrastructure-ts/bin/serverless-chat.ts
 *   役割: プロジェクト全体のエントリーポイント
 *   関係性: このファイルが RestApiStack を作成し、GET /config エンドポイントにこの Lambda 関数を紐付け
 * infrastructure-ts/lib/RestApiStack.ts
 *   役割: REST API のエンドポイントやリソースを定義
 *   関係性: GET /config エンドポイントを API Gateway に作成し、get-config.ts ハンドラーを紐付け
 * SSM Parameter Store
 *   関係性:
 *    /prod/cognito/signinurl: Cognito のログイン URL を安全に管理
 *    /prod/websocket/url: WebSocket のエンドポイント URL を安全に管理
 * resources/handlers/rest
 *   関係性:
 *    他のエンドポイント（例: /channels の GET や POST）と連携し、アプリケーション全体の構成を提供
 * フロントエンドとの関係
 *   このハンドラーで提供される構成情報は、クライアントアプリケーションが動作するために必要
 *    api_url: REST API のベースパス
 *    broadcast_url: WebSocket サーバーのエンドポイント
 *    login_url: Cognito 認証のサインイン URL
 * 
 * 
 * プロジェクト全体の流れ
 * 1. API Gateway:
 *   /config エンドポイントでこの Lambda ハンドラーが呼び出される
 * 2. Lambda:
 *   SSM Parameter Store から構成データを取得し、クライアントにレスポンスを返す
 * 3. フロントエンド:
 *   このエンドポイントから取得したデータを使用して、ログインや WebSocket 通信をセットアップ
 */
class Lambda implements LambdaInterface {
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "OK" };
    logger.addContext(context);

    try {

      // SSM Parameter Store からの設定値取得
      let cognitoSigninUrlParameter = await ssm.getParameter({Name: '/prod/cognito/signinurl', WithDecryption:true}).promise();
      // Cognito のログイン URL (/prod/cognito/signinurl) と WebSocket URL (/prod/websocket/url) を取得
      // WithDecryption: true によって暗号化された値を復号
      let websocketUrlParameter = await ssm.getParameter({Name: '/prod/websocket/url', WithDecryption:true}).promise();
      logger.debug("Cognito Signin URL:" + JSON.stringify(cognitoSigninUrlParameter));

      let config =    {
          "api_url": "/api",
          "broadcast_url": websocketUrlParameter.Parameter.Value,
          "login_url": cognitoSigninUrlParameter.Parameter.Value
      }
      response = { statusCode: 200, body: JSON.stringify(config) };

      logger.debug(`Sending config response: ${JSON.stringify(response)}`);
    }
    catch (e: any) {
      logger.debug(JSON.stringify(e));
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
