// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Status } from '../../models/status';
import { User } from '../../models/user';

/**
 * CONNECTIONS_TABLE_NAME: DynamoDB テーブル名（現在のアクティブな接続情報を保持）
 * COGNITO_USER_POOL_ID: Cognito ユーザープールの ID
 * AWS SDK クライアント:
 *   DynamoDB (ddb): 接続テーブルからデータを取得
 *   Cognito Identity Service Provider (cognito): Cognito ユーザープールからユーザーを取得
 */
const { CONNECTIONS_TABLE_NAME, LOG_LEVEL, COGNITO_USER_POOL_ID } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));
const cognito = tracer.captureAWSClient(new AWS.CognitoIdentityServiceProvider());

/**
 * このファイルは、REST API の /users エンドポイントで 
 * GET リクエストを処理する AWS Lambda ハンドラーの実装です
 * このハンドラーの主な役割は、現在の Cognito ユーザーリストと、
 * そのうちどのユーザーがオンラインかを判定し、クライアントに返却することです
 * 
 * 
 * 他のディレクトリやファイルとの関係性
 * infrastructure-ts/bin/serverless-chat.ts
 *   役割: プロジェクトのエントリーポイントとして、RestApiStack（REST API のリソース構築）を初期化
 *   関係性: このファイルで、get-users.ts が /users エンドポイントに紐付けられる
 * infrastructure-ts/lib/RestApiStack.ts
 *   役割: REST API のルーティング定義を管理
 *   関係性: /users エンドポイントが定義され、対応するハンドラーとして get-users.ts が割り当てられる
 * resources/models/user.ts
 *   役割: ユーザー情報のデータモデルを定義
 *   関係性: get-users.ts で返却するレスポンスの型を定義するために利用される
 * DynamoDB の接続テーブル
 *   役割: 各ユーザーの接続状態を保持
 *   関係性: オンライン/オフライン判定に必要なデータを提供
 * Cognito ユーザープール
 *   役割: アプリケーションで使用されるユーザーの認証・管理
 *   関係性: ユーザーリストを取得し、レスポンスを構築するための主要データソース
 * 
 * 
 * プロジェクト全体の流れ
 * 1. API Gateway からのリクエスト:
 *   /users エンドポイントにリクエストが送信される
 * 2. Lambda ハンドラーの実行:
 *   Cognito ユーザー情報と DynamoDB の接続情報を統合して、レスポンスを構築
 * 3. クライアントへのレスポンス:
 *   ユーザー名とそのステータス（ONLINE/OFFLINE）を JSON 形式で返す
 */
class Lambda implements LambdaInterface {
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "OK" };
    logger.addContext(context);

    try {

      // Get online users from connection table
      // アクティブな接続情報の取得
      // DynamoDB の CONNECTIONS_TABLE_NAME から現在のアクティブな接続（オンラインユーザー）を取得
      logger.debug('Retrieving active connections...');
      let connectionData = await ddb.scan({ TableName: CONNECTIONS_TABLE_NAME }).promise();
      logger.debug("DDB users: " + JSON.stringify(connectionData));

      // Get all cognito users
      // Cognito ユーザーリストの取得
      // Cognito ユーザープールからすべてのユーザーを取得
      var params = {
        UserPoolId: COGNITO_USER_POOL_ID
      };
      let cognitoUsers = await cognito.listUsers(params).promise();
      logger.debug("Cognito users: " +  JSON.stringify(cognitoUsers));

      // Merge list into response format
      // ユーザーリストの統合
      // 各 Cognito ユーザーの Username をキーにして、接続テーブル内に対応するエントリが存在するか確認
      // 存在する場合は、そのユーザーはオンラインと判断し、ステータスを ONLINE に設定
      let userList: User[] = cognitoUsers.Users.map((user:any)=> {
        let userIsConnected = connectionData.Items.find(((u: { userId: any; }) => u.userId === user.Username));
        return new User({
            username: user.Username,
            status: userIsConnected ? Status.ONLINE : Status.OFFLINE
        });
      });
      logger.debug('Compiled user list: ' + JSON.stringify(userList));

      // Send response
      response = { statusCode: 200, body: JSON.stringify(userList) };
    }
    catch (e: any) {
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
