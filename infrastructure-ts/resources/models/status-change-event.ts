// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Payload } from "./payload";
import { Status } from "./status";

/**
 * 役割: ユーザーのステータス（オンライン/オフライン）の変更イベントを表現
 * プロパティ:
 *   userId: ステータスが変更されたユーザーの ID
 *   currentStatus: 現在のステータス（ONLINE or OFFLINE）
 *   eventDate: ステータス変更の発生日時
 */
export class StatusChangeEvent extends Payload {
    constructor(init?:Partial<StatusChangeEvent>) {
        super("StatusChangeEvent");
        Object.assign(this, init);
    } 
    public userId!: string;
    public currentStatus!: Status;
    public eventDate!: Date;
}