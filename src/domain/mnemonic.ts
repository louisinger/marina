import { validateMnemonic } from 'bip39';

export type Mnemonic = string;

export function createMnemonic(mnemo: string): Mnemonic {
  // Trim start-end and replace multiple spaces in between with a single space
  const mnemonic = mnemo.trim().replace(/ +(?= )/g, '');

  if (!validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic');
  return mnemonic;
}
