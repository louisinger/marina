import {
  PENDING_TX_SET_ASSET,
  PENDING_TX_FLUSH,
  PENDING_TX_SET_ADDRESSES_AND_AMOUNT,
  PENDING_TX_SET_FEE_CHANGE_ADDRESS,
  PENDING_TX_SET_FEE_AMOUNT_AND_ASSET,
  UPDATE_TXS,
  PENDING_TX_SET_PSET,
  ADD_TX,
} from './action-types';
import { AnyAction } from 'redux';
import { Address } from '../../../domain/address';
import { TxDisplayInterface } from '../../../domain/transaction';
import { NetworkString } from 'ldk';

export function setAsset(asset: string): AnyAction {
  return { type: PENDING_TX_SET_ASSET, payload: { asset } };
}

export function setAddressesAndAmount(
  receipientAddress: Address,
  changeAddress: Address,
  amountInSatoshi: number
): AnyAction {
  return {
    type: PENDING_TX_SET_ADDRESSES_AND_AMOUNT,
    payload: { receipientAddress, changeAddress, amountInSatoshi },
  };
}

export function setFeeChangeAddress(feeChangeAddress: Address): AnyAction {
  return { type: PENDING_TX_SET_FEE_CHANGE_ADDRESS, payload: { feeChangeAddress } };
}

export function setFeeAssetAndAmount(feeAsset: string, feeAmountInSatoshi: number): AnyAction {
  return { type: PENDING_TX_SET_FEE_AMOUNT_AND_ASSET, payload: { feeAsset, feeAmountInSatoshi } };
}

export function flushPendingTx(): AnyAction {
  return { type: PENDING_TX_FLUSH };
}

export function updateTxs(): AnyAction {
  return {
    type: UPDATE_TXS,
  };
}

export function setPset(pset: string): AnyAction {
  return {
    type: PENDING_TX_SET_PSET,
    payload: { pset },
  };
}

export function addTx(tx: TxDisplayInterface, network: NetworkString): AnyAction {
  return {
    type: ADD_TX,
    payload: { tx, network },
  };
}
