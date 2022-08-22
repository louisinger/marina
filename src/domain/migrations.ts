import type { StateRestorerOpts } from 'ldk';
import { createMigrate } from 'redux-persist';
import type { PersistedState } from 'redux-persist/es/types';
import { walletInitState } from '../application/redux/reducers/wallet-reducer';
import type { MnemonicAccountData } from './account';
import { AccountType, initialRestorerOpts, MainAccountID } from './account';
import type { EncryptedMnemonic } from './encrypted-mnemonic';
import type { MasterBlindingKey } from './master-blinding-key';
import type { MasterXPub } from './master-extended-pub';
import type { WalletState } from './wallet';

// v4 is a fixed version of v3 about covenantTemplate field in CustomAccountData
export type WalletPersistedStateV4 = WalletState & Partial<PersistedState>;

export type WalletPersistedStateV3 = WalletPersistedStateV4;
type keysAddedInV3 = 'encryptedMnemonic' | 'accounts';
type deletedInV3 = {
  [MainAccountID]: MnemonicAccountData;
};

export type WalletPersistedStateV2 = Omit<WalletPersistedStateV3, keysAddedInV3> & deletedInV3; // the current version
type keysAddedInV2 = 'unspentsAndTransactions' | 'mainAccount' | 'updaterLoaders' | 'lockedUtxos';
type deletedInV2 = {
  encryptedMnemonic: EncryptedMnemonic;
  masterBlindingKey: MasterBlindingKey;
  masterXPub: MasterXPub;
  restorerOpts: StateRestorerOpts;
};

export type WalletPersistedStateV1 = Omit<WalletPersistedStateV2, keysAddedInV2> & deletedInV2;

export const walletMigrations = {
  4: (state: WalletPersistedStateV3) => ({
    ...state,
    accounts: accountsFieldRenameV4(state.accounts),
  }),
  3: (state: WalletPersistedStateV2): WalletPersistedStateV3 => ({
    ...state,
    encryptedMnemonic: state[MainAccountID].encryptedMnemonic,
    accounts: {
      [MainAccountID]: { ...state[MainAccountID], type: AccountType.MainAccount },
    },
  }),
  2: (state: WalletPersistedStateV1): WalletPersistedStateV2 => {
    return {
      mainAccount: {
        type: AccountType.MainAccount,
        encryptedMnemonic: state.encryptedMnemonic,
        masterBlindingKey: state.masterBlindingKey,
        masterXPub: state.masterXPub,
        restorerOpts: {
          liquid: initialRestorerOpts,
          testnet: initialRestorerOpts,
          regtest: initialRestorerOpts,
        },
      },
      deepRestorer: state.deepRestorer,
      passwordHash: state.passwordHash,
      unspentsAndTransactions: {
        mainAccount: walletInitState.unspentsAndTransactions.mainAccount,
      },
      updaterLoaders: 0,
      isVerified: state.isVerified,
      lockedUtxos: walletInitState.lockedUtxos,
    };
  },
};

function accountsFieldRenameV4(accounts: WalletPersistedStateV3['accounts']): WalletPersistedStateV4['accounts'] {
  const renamed: WalletPersistedStateV4['accounts'] = {};
  for (const [id, account] of Object.entries(accounts)) {
    renamed[id] = {
      ...account,
      contractTemplate: account.covenantDescriptors || undefined,
    };
  }
  return renamed;
}
// `as any` is needed (redux-persist doesn't support generic types in createMigrate func)
export const walletMigrate = createMigrate(walletMigrations as any);
