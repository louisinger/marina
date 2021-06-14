import { createMasterXPub, MasterXPub } from '../../domain/master-extended-pub';
import { EncryptedMnemonic } from '../../domain/encrypted-mnemonic';
import { Address, createAddress } from '../../domain/address';
import { Mnemonic, IdentityType, mnemonicRestorerFromEsplora } from 'ldk';
import { encrypt, hash } from './crypto';
import { Network } from '../../domain/network';
import { PasswordHash } from '../../domain/password-hash';
import { Mnemonic as Mnemo } from '../../domain/mnemonic';
import { createMasterBlindingKey, MasterBlindingKey } from '../../domain/master-blinding-key';
import { Password } from '../../domain/password';
import { explorerApiUrl } from './constants';

export interface WalletData {
  confidentialAddresses: Address[];
  encryptedMnemonic: EncryptedMnemonic;
  masterXPub: MasterXPub;
  masterBlindingKey: MasterBlindingKey;
  passwordHash: PasswordHash;
}

export async function createWalletFromMnemonic(
  password: Password,
  mnemonic: Mnemo,
  chain: Network
): Promise<WalletData> {
  const toRestore = new Mnemonic({
    chain,
    type: IdentityType.Mnemonic,
    opts: { mnemonic },
  });

  const mnemonicIdentity = await mnemonicRestorerFromEsplora(toRestore)({ esploraURL: explorerApiUrl[chain], gapLimit: 20 })
  const masterXPub = createMasterXPub(mnemonicIdentity.masterPublicKey);
  const masterBlindingKey = createMasterBlindingKey(mnemonicIdentity.masterBlindingKey);
  const encryptedMnemonic = encrypt(mnemonic, password);
  const passwordHash = hash(password);
  const addresses = (await mnemonicIdentity.getAddresses()).map((a) =>
    createAddress(a.confidentialAddress, a.derivationPath)
  );

  // Update React state
  return {
    confidentialAddresses: addresses,
    encryptedMnemonic,
    masterXPub,
    masterBlindingKey,
    passwordHash,
  };
}
