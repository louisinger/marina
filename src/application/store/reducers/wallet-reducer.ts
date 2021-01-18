import * as ACTION_TYPES from '../actions/action-types';
import { IWallet } from '../../../domain/wallet/wallet';
import { IError } from '../../../domain/common';

export const walletReducer = (state: IWallet[], [type, payload]: [string, any]): IWallet[] => {
  switch (type) {
    case ACTION_TYPES.WALLET_CREATE_SUCCESS: {
      const firstWallet: IWallet = {
        ...state[0],
        errors: undefined,
        masterXPub: payload.masterXPub.value,
        masterBlindingKey: payload.masterBlindingKey.value,
        encryptedMnemonic: payload.encryptedMnemonic.value,
        passwordHash: payload.passwordHash.value,
      };
      return Object.assign([], state, [firstWallet]);
    }
    case ACTION_TYPES.WALLET_RESTORE_SUCCESS: {
      const firstWallet: IWallet = {
        ...state[0],
        errors: undefined,
        restored: true,
      };
      return Object.assign([], state, [firstWallet]);
    }
    case ACTION_TYPES.WALLET_CREATE_FAILURE: {
      const firstWallet: IWallet = {
        ...state[0],
        errors: { create: { message: payload.error.message } as IError },
      };
      return Object.assign([], state, [firstWallet]);
    }
    case ACTION_TYPES.WALLET_RESTORE_FAILURE: {
      const firstWallet: IWallet = {
        ...state[0],
        errors: { restore: { message: payload.error.message } as IError },
      };
      return Object.assign([], state, [firstWallet]);
    }
    default: {
      return state;
    }
  }
};
