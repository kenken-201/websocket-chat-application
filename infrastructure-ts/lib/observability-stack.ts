// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from 'aws-cdk-lib';
import { Color, Dashboard, GraphWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

/**
 * このファイルは、AWS CloudWatch を用いた監視とモニタリングのための
 * ダッシュボードを定義する CDK スタックです
 * WebSocket チャットアプリケーションの主要なメトリクス（接続数やメッセージ配信数など）を
 * 可視化するためのダッシュボードを作成することで、
 * 運用中のアプリケーションの状態をリアルタイムに把握できるようにします
 * 
 * 機能概要
 * 目的:
 *   WebSocket チャットアプリケーションの主要な指標（新規接続、切断、メッセージ配信数）を監視するダッシュボードを作成
 * 出力:
 *   CloudWatch ダッシュボード（Serverless Websocket Chat Dashboard）が生成され、モニタリングが容易になる
 * 
 * 
 * 他のファイルやディレクトリとの関係性
 * 1. infrastructure-ts/bin/serverless-chat.ts
 *   役割: プロジェクト全体のエントリーポイントとして、ObservabilityStack を含むスタックをデプロイ
 *   関係性:
 *    このファイルで ObservabilityStack がインスタンス化され、AWS にリソースが作成される
 * 2. infrastructure-ts/lib/WebSocketApiStack.ts
 *   役割: WebSocket API を定義するスタック
 *   関係性:
 *    WebSocketApiStack で定義された API に対応するメトリクスを、ObservabilityStack のダッシュボードで監視する
 * 3. resources/handlers ディレクトリ
 *   役割: Lambda 関数の実装
 *   関係性:
 *    各種 Lambda 関数（connect.ts、disconnect.ts、send-message.ts など）から、
 *    アプリケーションのイベント（新規接続、切断、メッセージ送信）が発生
 *    これらのイベントをもとに、ObservabilityStack のダッシュボードでメトリクスが可視化される
 * 
 * 
 * プロジェクト全体の流れ
 * 1. WebSocket API イベントの発生:
 *   クライアントが接続、切断、またはメッセージ送信を行う
 * 2. メトリクスの更新:
 *   各イベントに応じて、CloudWatch のカスタムメトリクスが更新される
 *   （例: 新規接続時に newConnection メトリクスが増加）
 * 3. ダッシュボードでの監視:
 *   ObservabilityStack によって作成されたダッシュボードで、運用者がリアルタイムにメトリクスを確認
 */
export class ObservabilityStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // WebSocket チャットアプリケーションの監視対象メトリクスを定義
    /**
     * namespace: メトリクスのカテゴリ（websocket-chat）
     * metricName: 測定項目名
     *   closedConnection: 切断された接続数
     *   newConnection: 新規に確立された接続数
     *   messageDelivered: 配信されたメッセージの数
     * statistic: 表示統計値（合計値を使用
     */
    const disconnectionsMetric = new Metric({
      namespace: 'websocket-chat',
      metricName: 'closedConnection',
      statistic: 'sum'
    });

    const newcConnectionsMetric = new Metric({
      namespace: 'websocket-chat',
      metricName: 'newConnection',
      statistic: 'sum'
    });

    const messagesDeliveredMetric = new Metric({
      namespace: 'websocket-chat',
      metricName: 'messageDelivered',
      statistic: 'sum'
    });

    // CloudWatch ダッシュボードに表示されるグラフウィジェットを定義
    // 各ウィジェットに関連するメトリクスを指定し、色やサイズ（width）を設定
    var closedConnectionsWidget = new GraphWidget({
      title: "Closed Connections",
      width: 12,
      left: [disconnectionsMetric.with({
        color: Color.RED
      })]
    });

    var newConnectionsWidget = new GraphWidget({
      title: "New Connections",
      width: 12,
      left: [newcConnectionsMetric.with({
        color: Color.GREEN
      })]
    });

    var messagesDeliveredWidgets = new GraphWidget({
      title: "Messages Delivered",
      width: 24,
      left: [messagesDeliveredMetric.with({
        color: Color.GREEN
      })]
    });

    // Dashboard:
    //   AWS CloudWatch ダッシュボードを生成
    //   ウィジェットを配列として渡し、レイアウトを指定
    // レイアウト:
    //   1行目: 新規接続と切断のグラフを並べて表示
    //   2行目: メッセージ配信数を横幅いっぱいに表示
    const dashboard = new Dashboard(this, "Serverless Websocket Chat Dashboard", {
      widgets: [
        [
          newConnectionsWidget,
          closedConnectionsWidget
        ],
        [
          messagesDeliveredWidgets,
        ]
      ]
    });
  }
};
