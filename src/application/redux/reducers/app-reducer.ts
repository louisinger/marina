import {
  BlockstreamExplorerURLs,
  BlockstreamTestnetExplorerURLs,
  IApp,
  NigiriDefaultExplorerURLs,
} from '../../../domain/app';
import { IError } from '../../../domain/common';
import { AnyAction } from 'redux';
import * as ACTION_TYPES from '../actions/action-types';
import { NetworkString } from 'ldk';

export const appInitState: IApp = {
  isOnboardingCompleted: false,
  isAuthenticated: false,
  network: (process.env.NETWORK as NetworkString) || 'liquid',
  explorerByNetwork: {
    regtest: NigiriDefaultExplorerURLs,
    liquid: BlockstreamExplorerURLs,
    testnet: BlockstreamTestnetExplorerURLs,
  },
};

export function appReducer(state: IApp = appInitState, { type, payload }: AnyAction): IApp {
  switch (type) {
    case ACTION_TYPES.RESET_APP: {
      return appInitState;
    }

    case ACTION_TYPES.AUTHENTICATION_SUCCESS: {
      return {
        ...state,
        isAuthenticated: true,
      };
    }
    case ACTION_TYPES.AUTHENTICATION_FAILURE: {
      return {
        ...state,
        errors: { auth: { message: payload.error.message } as IError },
      };
    }

    case ACTION_TYPES.ONBOARDING_COMPLETETED: {
      return {
        ...state,
        isOnboardingCompleted: true,
      };
    }

    case ACTION_TYPES.LOGOUT_SUCCESS: {
      return {
        ...state,
        isAuthenticated: false,
      };
    }

    case ACTION_TYPES.CHANGE_NETWORK_SUCCESS: {
      return {
        ...state,
        network: payload.network,
      };
    }

    case ACTION_TYPES.SET_EXPLORER: {
      return {
        ...state,
        explorerByNetwork: { ...state.explorerByNetwork, [payload.network]: payload.explorer },
      };
    }

    default:
      return state;
  }
}
