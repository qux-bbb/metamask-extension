import { ApprovalControllerState } from '@metamask/approval-controller';
import { TransactionType } from '@metamask/transaction-controller';

export type TypedSignDataV1Type = {
  name: string;
  value: string;
  type: string;
}[];

export type SignatureRequestType = {
  chainId?: string;
  id: string;
  msgParams?: {
    from: string;
    origin: string;
    data: string | TypedSignDataV1Type;
    version?: string;
  };
  type: TransactionType;
  custodyId?: string;
};

export type Confirmation = SignatureRequestType;

export type ConfirmMetamaskState = {
  confirm: {
    currentConfirmation?: Confirmation;
  };
  metamask: {
    pendingApprovals: ApprovalControllerState['pendingApprovals'];
    approvalFlows: ApprovalControllerState['approvalFlows'];
  };
};
