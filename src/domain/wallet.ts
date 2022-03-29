import type { AccountData, AccountID } from './account';
import type { EncryptedMnemonic } from './encrypted-mnemonic';
import type { PasswordHash } from './password-hash';
import type { UtxosAndTxsByNetwork } from './transaction';

type OmitMnemonic<T> = Omit<T, 'encryptedMnemonic'>;

export interface WalletState {
  encryptedMnemonic: EncryptedMnemonic;
  accounts: {
    [id: AccountID]: OmitMnemonic<AccountData>;
  }
  unspentsAndTransactions: Record<AccountID, UtxosAndTxsByNetwork>;
  passwordHash: PasswordHash;
  deepRestorer: {
    gapLimit: number;
    isLoading: boolean;
    error?: string;
  };
  updaterLoaders: number;
  isVerified: boolean;
}
