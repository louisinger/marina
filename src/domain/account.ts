import {
  IdentityInterface,
  MasterPublicKey,
  Mnemonic,
  StateRestorerOpts,
  Restorer,
  EsploraRestorerOpts,
  masterPubKeyRestorerFromEsplora,
  NetworkString,
  getScripts,
  TxInterface,
  networks,
} from 'ldk';
import { decrypt, toDisplayTransaction } from '../application/utils';
import {
  newMasterPublicKey,
  restoredMasterPublicKey,
  restoredMnemonic,
} from '../application/utils/restorer';
import { EncryptedMnemonic } from './encrypted-mnemonic';
import { MasterBlindingKey } from './master-blinding-key';
import { MasterXPub } from './master-extended-pub';

export const MainAccountID = 'mainAccount';
export const RestrictedAssetAccountID = 'restrictedAssetAccount';

export type AccountID = MainAccountID;

/**
 * Account domain represents the keys of the User
 *
 * - each Account is a derived of master private key (computed from mnemonic).
 * - an Account returns two types of identities: a WatchOnly identity and a signing Identity.
 *    the watch-only identity is used to update utxos and transactions state
 *    the signing identity is used to sign inputs. it needs the user's password to decrypt the mnemonic.
 */
export interface Account<
  SignID extends IdentityInterface = IdentityInterface,
  WatchID extends IdentityInterface = IdentityInterface
> {
  getAccountID(): AccountID;
  getSigningIdentity(password: string): Promise<SignID>;
  getWatchIdentity(): Promise<WatchID>;
  getDeepRestorer(): Restorer<EsploraRestorerOpts, WatchID>;
}

// Main Account uses the default Mnemonic derivation path
// single-sig account used to send/receive regular assets
export type MnemonicAccount = Account<Mnemonic, MasterPublicKey>;

export interface MnemonicAccountData {
  encryptedMnemonic: EncryptedMnemonic;
  restorerOpts: StateRestorerOpts;
  masterXPub: MasterXPub;
  masterBlindingKey: MasterBlindingKey;
}

export function createMnemonicAccount(
  data: MnemonicAccountData,
  network: NetworkString
): MnemonicAccount {
  return {
    getAccountID: () => MainAccountID,
    getSigningIdentity: (password: string) =>
      restoredMnemonic(decrypt(data.encryptedMnemonic, password), data.restorerOpts, network),
    getWatchIdentity: () =>
      restoredMasterPublicKey(data.masterXPub, data.masterBlindingKey, data.restorerOpts, network),
    getDeepRestorer: () =>
      masterPubKeyRestorerFromEsplora(
        newMasterPublicKey(data.masterXPub, data.masterBlindingKey, network)
      ),
  };
}

export const toDisplayTxForAccount = (account: Account) => async (network: NetworkString) => {
  const watchIdentity = await account.getWatchIdentity();
  const addresses = await watchIdentity.getAddresses();
  const walletScripts = getScripts(addresses);
  return function (tx: TxInterface) {
    return toDisplayTransaction(tx, Array.from(walletScripts.values()), networks[network]);
  };
};
