import { stringify } from '../../application/utils/browser-storage-converters';
import type { StoreCache } from '../store-cache';
import { compareCacheForEvents, newCacheFromState, newStoreCache } from '../store-cache';
import type { BrokerOption } from '../broker';
import Broker from '../broker';
import type { MessageHandler } from '../../domain/message';
import {
  subscribeScriptsMsg,
  newErrorResponseMessage,
  newSuccessResponseMessage,
} from '../../domain/message';
import Marina from '../../inject/marina/provider';
import type { RootReducerState } from '../../domain/common';
import {
  disableWebsite,
  flushMsg,
  flushTx,
  selectHostname,
  setCreateAccountData,
  setMsg,
  setTx,
  setTxData,
} from '../../application/redux/actions/connect';
import {
  selectAccount,
  selectAllAccounts,
  selectAllAccountsIDs,
  selectMainAccount,
  selectRestorerOpts,
  selectTransactions,
  selectUtxos,
} from '../../application/redux/selectors/wallet.selector';
import {
  updateToNextAddress,
  updateToNextChangeAddress,
  setCustomScriptTemplate,
  setIsSpendableByMarina,
} from '../../application/redux/actions/wallet';
import { selectBalances } from '../../application/redux/selectors/balance.selector';
import { assetGetterFromIAssets } from '../../domain/assets';
import type {
  Balance,
  Template,
  RawHex,
  Recipient,
  Utxo,
  AddressInterface as ProviderAddressInterface,
} from 'marina-provider';
import type { SignTransactionPopupResponse } from '../../presentation/connect/sign-pset';
import type { SpendPopupResponse } from '../../presentation/connect/spend';
import type { SignMessagePopupResponse } from '../../presentation/connect/sign-msg';
import type { AccountID, CustomScriptAccount, MnemonicAccount } from '../../domain/account';
import { AccountType, MainAccountID } from '../../domain/account';
import type { AddressInterface, UnblindedOutput } from 'ldk';
import { address, getAsset, getSats } from 'ldk';
import { selectEsploraURL, selectNetwork } from '../../application/redux/selectors/app.selector';
import { broadcastTx, lbtcAssetByNetwork } from '../../application/utils/network';
import { sortRecipients } from '../../application/utils/transaction';
import { selectTaxiAssets } from '../../application/redux/selectors/taxi.selector';
import type { BrokerProxyStore } from '../brokerProxyStore';
import type { CreateAccountPopupResponse } from '../../presentation/connect/create-account';
import { addUnconfirmedUtxos, lockUtxo } from '../../application/redux/actions/utxos';
import { getUtxosFromTx } from '../../application/utils/utxos';
import type { UnconfirmedOutput } from '../../domain/unconfirmed';
import type { Artifact, ArtifactFunction } from '@ionio-lang/ionio';
import { PrimitiveType } from '@ionio-lang/ionio';
import type { AnyAction } from 'redux';
import { isTaprootAddressInterface } from '../../domain/customscript-identity';

export default class MarinaBroker extends Broker<keyof Marina> {
  private static NotSetUpError = new Error('proxy store and/or cache are not set up');
  private cache: StoreCache;
  private hostname: string;
  private selectedAccount: AccountID = MainAccountID;

  static async Start(hostname?: string) {
    const broker = new MarinaBroker(hostname, [await MarinaBroker.WithProxyStore()]);
    broker.start();
  }

  private constructor(hostname = '', brokerOpts?: BrokerOption[]) {
    super(Marina.PROVIDER_NAME, brokerOpts);
    this.hostname = hostname;
    this.cache = newStoreCache();
    this.subscribeToStoreEvents();
  }

  protected start() {
    super.start(this.marinaMessageHandler);
  }

  // start the store.subscribe function
  // used in `Broker.WithProxyStore` option
  private subscribeToStoreEvents() {
    if (!this.store) throw MarinaBroker.NotSetUpError;

    this.store.subscribe(() => {
      if (!this.store) throw MarinaBroker.NotSetUpError;
      const state = this.store.getState();
      const allAccountsIDs = selectAllAccountsIDs(state);
      const newCache = newCacheFromState(state, allAccountsIDs);
      const events = compareCacheForEvents(newCache, this.cache, this.hostname, allAccountsIDs);

      this.cache = newCache; // update the cache state

      for (const ev of events) {
        window.dispatchEvent(
          new CustomEvent(`marina_event_${ev.type.toLowerCase()}`, {
            detail: stringify(ev.payload),
          })
        );
      }
    });
  }

  private get accountSelector() {
    return selectAccount(this.selectedAccount);
  }

  private hostnameEnabled(state: RootReducerState): boolean {
    const enabledSites = state.connect.enabledSites[state.app.network];
    return enabledSites.includes(this.hostname);
  }

  private checkHostnameAuthorization() {
    if (!this.hostnameEnabled(this.state))
      throw new Error('User must authorize the current website');
  }

  get state() {
    if (!this.store) throw MarinaBroker.NotSetUpError;
    return this.store.getState();
  }

  private accountExists(name: string): boolean {
    if (!this.store) throw MarinaBroker.NotSetUpError;
    return selectAllAccountsIDs(this.store.getState()).includes(name);
  }

  // locks utxos used on transaction
  // credit change utxos to balance
  private async lockAndLoadUtxos(
    signedTxHex: RawHex,
    selectedUtxos: UnblindedOutput[] | undefined,
    changeUtxos: UnconfirmedOutput[] | undefined,
    store: BrokerProxyStore
  ) {
    const state = store.getState();

    // lock utxos used on transaction
    if (selectedUtxos) {
      for (const utxo of selectedUtxos) {
        await store.dispatchAsync(lockUtxo(utxo));
      }
    }

    // credit change utxos to balance
    if (changeUtxos && changeUtxos.length > 0) {
      store.dispatch(
        await addUnconfirmedUtxos(signedTxHex, changeUtxos, MainAccountID, selectNetwork(state))
      );
    }
  }

  private handleIdsParam(ids?: AccountID[]): AccountID[] {
    if (!ids) return [MainAccountID];
    if (ids.length === 0) return [];
    return ids;
  }

  private marinaMessageHandler: MessageHandler<keyof Marina> = async ({ id, name, params }) => {
    if (!this.store || !this.hostname) throw MarinaBroker.NotSetUpError;
    const successMsg = <T = any>(data?: T) => newSuccessResponseMessage(id, data);

    try {
      switch (name) {
        case 'getNetwork': {
          return successMsg(this.state.app.network);
        }

        case 'isEnabled': {
          return successMsg(this.hostnameEnabled(this.state));
        }

        case 'enable': {
          if (!this.hostnameEnabled(this.state)) {
            await this.store.dispatchAsync(selectHostname(this.hostname, this.state.app.network));
            const accepted = await this.openAndWaitPopup<boolean>('enable');
            if (!accepted) throw new Error(`user rejected to enable ${this.hostname}`);
            return successMsg();
          }
          throw new Error('current site is already enabled');
        }

        case 'disable': {
          await this.store.dispatchAsync(disableWebsite(this.hostname, this.state.app.network));
          return successMsg();
        }

        case 'getAddresses': {
          this.checkHostnameAuthorization();
          const accountIds = this.handleIdsParam(params ? params[0] : undefined);
          const net = selectNetwork(this.state);

          const identities = await Promise.all(
            accountIds.map(selectAccount).map((f) => f(this.state).getWatchIdentity(net))
          );
          const addresses = await Promise.all(
            identities.map((identity) => identity.getAddresses())
          );

          return successMsg(addresses.flat().map(toProviderAddress));
        }

        case 'getNextAddress': {
          this.checkHostnameAuthorization();
          const account = this.accountSelector(this.state);
          if (params && params.length > 0 && account.type !== AccountType.CustomScriptAccount) {
            throw new Error('Only custom script accounts can expect construct parameters');
          }
          const net = selectNetwork(this.state);
          let nextAddress: AddressInterface;
          const restorerOpts = selectRestorerOpts(this.selectedAccount)(this.state);
          switch (account.type) {
            case AccountType.CustomScriptAccount: {
              const watchOnlyIdentity = (
                account as CustomScriptAccount
              ).getNotRestoredWatchIdentity(net);
              nextAddress = watchOnlyIdentity.getAddress(
                false,
                increment(restorerOpts.lastUsedExternalIndex),
                params?.[0]
              );
              break;
            }

            case AccountType.MainAccount: {
              const watchOnlyIdentity = (account as MnemonicAccount).getNotRestoredWatchIdentity(
                net
              );
              nextAddress = watchOnlyIdentity.getAddress(
                false,
                increment(restorerOpts.lastUsedExternalIndex)
              ).address;
              break;
            }

            default: {
              const watchOnlyIdentity = await account.getWatchIdentity(net);
              nextAddress = await watchOnlyIdentity.getNextAddress(params?.[0]);
              break;
            }
          }

          await Promise.all(
            updateToNextAddress(account.getInfo().accountID, net, params?.[0]).map(
              (action: AnyAction) => this.store?.dispatchAsync(action)
            )
          );
          this.backgroundScriptPort.postMessage(
            subscribeScriptsMsg(
              [address.toOutputScript(nextAddress.confidentialAddress).toString('hex')],
              account.getInfo().accountID,
              net
            )
          );
          return successMsg(toProviderAddress(nextAddress));
        }

        case 'getNextChangeAddress': {
          this.checkHostnameAuthorization();
          const account = this.accountSelector(this.state);
          if (params && params.length > 0 && account.type !== AccountType.CustomScriptAccount) {
            throw new Error('Only custom script accounts can expect construct parameters');
          }

          const net = selectNetwork(this.state);
          const restorerOpts = selectRestorerOpts(this.selectedAccount)(this.state);
          let nextChangeAddress: AddressInterface;

          switch (account.type) {
            case AccountType.CustomScriptAccount: {
              const watchOnlyIdentity = (
                account as CustomScriptAccount
              ).getNotRestoredWatchIdentity(net);
              nextChangeAddress = watchOnlyIdentity.getAddress(
                true,
                increment(restorerOpts.lastUsedInternalIndex),
                params?.[0]
              );
              break;
            }

            case AccountType.MainAccount: {
              const watchOnlyIdentity = (account as MnemonicAccount).getNotRestoredWatchIdentity(
                net
              );
              nextChangeAddress = watchOnlyIdentity.getAddress(
                true,
                increment(restorerOpts.lastUsedInternalIndex)
              ).address;
              break;
            }

            default: {
              const watchOnlyIdentity = await account.getWatchIdentity(net);
              nextChangeAddress = await watchOnlyIdentity.getNextChangeAddress(params?.[0]);
              this.backgroundScriptPort.postMessage(
                subscribeScriptsMsg(
                  [address.toOutputScript(nextChangeAddress.confidentialAddress).toString('hex')],
                  account.getInfo().accountID,
                  net
                )
              );
              break;
            }
          }

          await Promise.all(
            updateToNextChangeAddress(account.getInfo().accountID, net, params?.[0]).map(
              (action: AnyAction) => this.store?.dispatchAsync(action)
            )
          );

          return successMsg(toProviderAddress(nextChangeAddress));
        }

        case 'signTransaction': {
          this.checkHostnameAuthorization();
          if (!params || params.length !== 1) {
            throw new Error('Missing params');
          }
          const [pset] = params;
          await this.store.dispatchAsync(setTx(this.hostname, pset));
          const { accepted, signedPset } =
            await this.openAndWaitPopup<SignTransactionPopupResponse>('sign-pset');

          await this.store.dispatchAsync(flushTx());
          if (!accepted) throw new Error('User rejected the sign request');
          if (!signedPset) throw new Error('Something went wrong with tx signing');

          return successMsg(signedPset);
        }

        case 'sendTransaction': {
          this.checkHostnameAuthorization();
          const [recipients, feeAssetHash] = params as [Recipient[], string | undefined];
          const lbtc = lbtcAssetByNetwork(selectNetwork(this.state));
          const feeAsset = feeAssetHash ? feeAssetHash : lbtc;

          // validate if fee asset is valid
          if (![lbtc, ...selectTaxiAssets(this.state)].includes(feeAsset)) {
            throw new Error(`${feeAsset} not supported as fee asset.`);
          }

          // validate object recipient (asset and value)
          // - if no asset is present, assume lbtc for the current network
          // - value must be present, a safe integer and higher or equal to zero
          // - if value is for example 1.0, parseInt it to eliminate float
          for (const rcpt of recipients) {
            if (!rcpt.asset) {
              if (!lbtc) throw new Error('missing asset on recipient');
              rcpt.asset = lbtc;
            }
            if (!rcpt.value) throw new Error('missing value on recipient');
            if (!Number.isSafeInteger(rcpt.value)) throw new Error('invalid value on recipient');
            if (rcpt.value < 0) throw new Error('negative value on recipient');
            rcpt.value = parseInt(rcpt.value.toString(), 10);
          }

          const { addressRecipients, data } = sortRecipients(recipients);

          await this.store.dispatchAsync(
            setTxData(this.hostname, addressRecipients, feeAsset, selectNetwork(this.state), data)
          );

          const { accepted, signedTxHex, selectedUtxos, unconfirmedOutputs } =
            await this.openAndWaitPopup<SpendPopupResponse>('spend');

          if (!accepted) throw new Error('the user rejected the create tx request');
          if (!signedTxHex) throw new Error('something went wrong with the tx crafting');

          const txid = await broadcastTx(selectEsploraURL(this.state), signedTxHex);
          if (!txid) throw new Error('something went wrong with the tx broadcasting');

          // lock selected utxos and credit change utxos (aka unconfirmed outputs)
          await this.lockAndLoadUtxos(signedTxHex, selectedUtxos, unconfirmedOutputs, this.store);

          return successMsg({ txid, hex: signedTxHex });
        }

        case 'signMessage': {
          this.checkHostnameAuthorization();
          const [message] = params as [string];
          await this.store.dispatchAsync(setMsg(this.hostname, message));
          const { accepted, signedMessage } = await this.openAndWaitPopup<SignMessagePopupResponse>(
            'sign-msg'
          );

          await this.store.dispatchAsync(flushMsg());
          if (!accepted) throw new Error('user rejected the signMessage request');
          if (!signedMessage) throw new Error('something went wrong with message signing');

          return successMsg(signedMessage);
        }

        case 'getTransactions': {
          this.checkHostnameAuthorization();
          const accountsIDs = this.handleIdsParam(params ? params[0] : undefined);
          const transactions = selectTransactions(...accountsIDs)(this.state);
          return successMsg(transactions);
        }

        case 'getCoins': {
          this.checkHostnameAuthorization();
          const accountsIDs = this.handleIdsParam(params ? params[0] : undefined);
          const coins = selectUtxos(...accountsIDs)(this.state);
          const results: Utxo[] = coins.map((unblindedOutput) => ({
            txid: unblindedOutput.txid,
            vout: unblindedOutput.vout,
            prevout: unblindedOutput.prevout,
            unblindData: unblindedOutput.unblindData,
            asset: getAsset(unblindedOutput),
            value: getSats(unblindedOutput),
          }));
          return successMsg(results);
        }

        case 'getBalances': {
          this.checkHostnameAuthorization();
          const accountsIDs = this.handleIdsParam(params ? params[0] : undefined);
          const balances = selectBalances(...accountsIDs)(this.state);
          const assetGetter = assetGetterFromIAssets(this.state.assets);
          const balancesResult: Balance[] = [];
          for (const [assetHash, amount] of Object.entries(balances)) {
            balancesResult.push({ asset: assetGetter(assetHash), amount });
          }
          return successMsg(balancesResult);
        }

        case 'isReady': {
          try {
            const net = selectNetwork(this.state);
            await selectMainAccount(this.state).getWatchIdentity(net); // check if Xpub is valid
            return successMsg(this.state.app.isOnboardingCompleted);
          } catch {
            // catch error = not ready
            return successMsg(false);
          }
        }

        case 'getFeeAssets': {
          this.checkHostnameAuthorization();
          const lbtcAsset = lbtcAssetByNetwork(selectNetwork(this.state));
          return successMsg([lbtcAsset, ...selectTaxiAssets(this.state)]);
        }

        // TODO remove this method
        case 'reloadCoins': {
          this.checkHostnameAuthorization();
          return successMsg();
        }

        case 'getSelectedAccount': {
          this.checkHostnameAuthorization();
          return successMsg(this.selectedAccount);
        }

        case 'useAccount': {
          this.checkHostnameAuthorization();
          const [accountName] = params as [string];
          if (!this.accountExists(accountName)) {
            throw new Error(`Account ${accountName} not found`);
          }

          this.selectedAccount = accountName;
          return successMsg(true);
        }

        case 'importTemplate': {
          this.checkHostnameAuthorization();
          const accountData = this.state.wallet.accounts[this.selectedAccount];
          if (accountData.type !== AccountType.CustomScriptAccount) {
            throw new Error('Only custom script accounts can import templates');
          }

          let contract: Template | undefined;
          let changeContract: Template | undefined;
          if (params && params.length > 0) {
            if (!validateTemplate(params[0])) {
              throw new Error('Invalid template');
            }
            contract = params[0];

            if (params[1]) {
              if (!validateTemplate(params[1])) {
                throw new Error('Invalid change template');
              }
              changeContract = params[1];
            }
          }

          await this.store.dispatchAsync(
            setCustomScriptTemplate(
              this.selectedAccount,
              contract!.template,
              changeContract?.template
            )
          );

          const isFuncSpendable = (fn: ArtifactFunction) => {
            return (
              fn.functionInputs.length === 1 &&
              fn.functionInputs[0].type === PrimitiveType.Signature &&
              (!fn.require || fn.require.length === 0)
            );
          };

          const artifact: Artifact = JSON.parse(contract!.template);
          let isSpendableByMarina = artifact.functions.every(isFuncSpendable);

          if (isSpendableByMarina && changeContract) {
            const changeArtifact = JSON.parse(changeContract.template);
            isSpendableByMarina = changeArtifact.functions.every(isFuncSpendable);
          }

          await this.store.dispatchAsync(
            setIsSpendableByMarina(this.selectedAccount, isSpendableByMarina)
          );

          return successMsg(true);
        }

        case 'createAccount': {
          this.checkHostnameAuthorization();
          const [accountName] = params as [string];
          if (this.accountExists(accountName)) {
            throw new Error(`Account ${accountName} already exists`);
          }

          await this.store.dispatchAsync(
            setCreateAccountData({
              namespace: accountName,
              hostname: this.hostname,
            })
          );

          const { accepted } = await this.openAndWaitPopup<CreateAccountPopupResponse>(
            'create-account'
          );
          if (!accepted) throw new Error('user rejected the create account request');

          return successMsg(accepted);
        }

        case 'broadcastTransaction': {
          this.checkHostnameAuthorization();
          const [signedTxHex] = params as [string];
          const network = selectNetwork(this.state);

          // broadcast tx
          const txid = await broadcastTx(selectEsploraURL(this.state), signedTxHex);
          if (!txid) throw new Error('something went wrong with the tx broadcasting');

          // get selected and change utxos from transaction
          const accounts = selectAllAccounts(this.state);
          const coins = selectUtxos(...selectAllAccountsIDs(this.state))(this.state);

          const { selectedUtxos, changeUtxos } = await getUtxosFromTx(
            accounts,
            coins,
            network,
            signedTxHex
          );

          // lock selected utxos and credit change utxos
          await this.lockAndLoadUtxos(signedTxHex, selectedUtxos, changeUtxos, this.store);

          return successMsg({ txid, hex: signedTxHex });
        }

        case 'getAccountInfo': {
          this.checkHostnameAuthorization();
          let [accountName] = params as [string];
          if (!accountName) accountName = MainAccountID;

          if (!this.accountExists(accountName)) {
            throw new Error(`Account ${accountName} not found`);
          }

          const info = selectAccount(accountName)(this.state).getInfo();
          return successMsg(info);
        }

        case 'getAccountsIDs': {
          this.checkHostnameAuthorization();
          return successMsg(selectAllAccountsIDs(this.state));
        }

        default:
          return newErrorResponseMessage(id, new Error('Method not implemented.'));
      }
    } catch (err) {
      if (err instanceof Error) return newErrorResponseMessage(id, err);
      else throw err;
    }
  };
}

function validateTemplate(template: Template): Template<string> | undefined {
  switch (template.type as string) {
    case 'ionio-artifact': {
      const artifact = JSON.parse(template.template);
      const expectedProperties = ['contractName', 'functions', 'constructorInputs'];
      if (!expectedProperties.every((property) => property in artifact)) {
        throw new Error('Invalid template: incomplete artifact');
      }
      return template;
    }
    default: {
      throw new Error(`Unknown template type ${template.type}`);
    }
  }
}

// converts an addressInterface to the marina-provider format
function toProviderAddress(addr: AddressInterface): ProviderAddressInterface {
  const result = {
    blindingPrivateKey: addr.blindingPrivateKey,
    confidentialAddress: addr.confidentialAddress,
    derivationPath: addr.derivationPath,
    publicKey: addr.publicKey,
  };

  if (isTaprootAddressInterface(addr)) {
    return {
      ...result,
      constructorParams: addr.constructorParams,
      descriptor: addr.descriptor,
    };
  }

  return result;
}
const increment = (n: number | undefined): number => {
  if (n === undefined || n === null || n === -1) return 0;
  if (n < 0) return 1; // -Infinity = 0, return 0+1=1
  return n + 1;
};
