import type { BPointTxnResponse } from "@/lib/bpoint";

export const approvedTxnResponse: BPointTxnResponse = {
  APIResponse: { ResponseCode: 0, ResponseText: "Success" },
  TxnResp: {
    TxnNumber: "TXN-APPROVED-001",
    Approved: true,
    Crn1: "sess-test-001",
    Amount: 132000,
    BankResponseCode: "00",
    ResponseText: "Approved",
  },
};

export const declinedTxnResponse: BPointTxnResponse = {
  APIResponse: { ResponseCode: 0, ResponseText: "Success" },
  TxnResp: {
    TxnNumber: "TXN-DECLINED-001",
    Approved: false,
    Crn1: "sess-test-001",
    Amount: 132000,
    BankResponseCode: "05",
    ResponseText: "Do not honour",
  },
};

export const invalidCardTxnResponse: BPointTxnResponse = {
  APIResponse: { ResponseCode: 0, ResponseText: "Success" },
  TxnResp: {
    TxnNumber: "TXN-INVALID-001",
    Approved: false,
    Crn1: "sess-test-001",
    Amount: 132000,
    BankResponseCode: "14",
    ResponseText: "Invalid card number",
  },
};

export const expiredAuthKeyResponse: BPointTxnResponse = {
  APIResponse: { ResponseCode: 5001, ResponseText: "AuthKey expired" },
  TxnResp: null,
};
