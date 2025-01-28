// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Generic payload wrapper for websocket communication.
// Helps identifying the different models exchanged over the wire.
/**
 * 役割:
 *   すべてのデータモデルの基底クラス（親クラス）
 *   各データが type プロパティを持つことで、データの種類を区別する
 * 使用例:
 *   Message や StatusChangeEvent は、このクラスを拡張して type を設定
 */
export class Payload {
    constructor(public type: string) {
    }
}