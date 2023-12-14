import React, { useEffect, useState } from 'react';
import ZKPLib from '@vulpemventures/secp256k1-zkp';
import Button from '../components/button';
import ShellConnectPopup from '../components/shell-connect-popup';
import ModalUnlock from '../components/modal-unlock';
import { SOMETHING_WENT_WRONG_ERROR } from '../../domain/constants';
import ButtonsAtBottom from '../components/buttons-at-bottom';
import {
  useSelectPopupHostname,
  useSelectPopupPsetToSign,
} from '../../infrastructure/storage/common';
import { SignerService } from '../../application/signer';
import { popupResponseMessage } from '../../domain/message';
import { Pset } from 'liquidjs-lib';
import { useBackgroundPortContext } from '../context/background-port-context';
import { useStorageContext } from '../context/storage-context';
import { useToastContext } from '../context/toast-context';
import { extractErrorMessage } from '../utility/error';
import { fromSatoshiStr } from '../utility';
import { Spinner } from '../components/spinner';
import type { TxDetailsExtended, TxFlow } from '../../domain/transaction';
import { computeTxDetailsExtended } from '../../domain/transaction';
import { MainAccount, MainAccountLegacy, MainAccountTest } from '../../application/account';
import { DefaultAssetRegistry } from '../../port/asset-registry';
import { WalletRepositoryUnblinder } from '../../application/unblinder';
import type { Outpoint } from '../../domain/repository';
import type { UnblindingData } from 'marina-provider';

const NonStandardPsetWarning: React.FC = () => {
  return (
    <div className="bg-amberLight border-amber text-amberDark p-4 m-2" role="alert">
      <p className="font-bold">Warning</p>
      <p>
        This PSET is not standard, it does not spend coins from any of your main accounts but asks
        for a signature.
      </p>
    </div>
  );
};

const PsetView: React.FC<Pick<TxDetailsExtended, 'txFlow'>> = ({ txFlow }) => {
  const { cache, assetRepository } = useStorageContext();
  const getPrecision = (asset: string) => {
    if (!cache || !cache.assetsDetails || !cache.assetsDetails.value[asset]) return 8;
    const assetInfo = cache.assetsDetails.value[asset];
    return assetInfo.precision;
  };

  const getTicker = (asset: string) => {
    if (!cache || !cache.assetsDetails || !cache.assetsDetails.value[asset])
      return asset.slice(0, 4);
    const assetInfo = cache.assetsDetails.value[asset];
    return assetInfo.ticker;
  };

  useEffect(() => {
    const assetRegistry = new DefaultAssetRegistry(cache?.network || 'liquid');
    const fetchUnknownAssets = async () => {
      const unknownAssets = Object.keys(txFlow).filter(
        (asset) => getTicker(asset) === asset.slice(0, 4)
      );
      if (unknownAssets.length === 0) return;
      const assets = await Promise.allSettled(
        unknownAssets.map((asset) => assetRegistry.getAsset(asset))
      );

      for (const asset of assets) {
        if (asset.status === 'fulfilled') {
          await assetRepository.addAsset(asset.value.assetHash, asset.value);
        }
      }
    };

    fetchUnknownAssets().catch(console.error);
  }, []);

  return (
    <div className="flex flex-col">
      <p className="mb-4 text-base font-medium text-center">Requests you to spend</p>
      <div className="container flex flex-col mt-6">
        {Object.entries(txFlow)
          .filter(([, value]) => value < 0)
          .map(([asset, value], index, array) => (
            <div key={index}>
              <div className="container flex justify-between">
                <span data-testid={asset} className="text-lg font-medium">
                  {fromSatoshiStr(Math.abs(value), getPrecision(asset))}{' '}
                </span>
                <span className="text-lg font-medium">{getTicker(asset)}</span>
              </div>
              {index < array.length - 1 && (
                <div className="w-64 mx-auto border-b-0.5 border-primary pt-1.5 mb-1.5" />
              )}
            </div>
          ))}
      </div>
    </div>
  );
};

export interface SignTransactionPopupResponse {
  accepted: boolean;
  signedPset?: string;
}

const ConnectSignTransaction: React.FC = () => {
  const { walletRepository, appRepository, assetRepository } = useStorageContext();
  const { showToast } = useToastContext();
  const { backgroundPort } = useBackgroundPortContext();

  const [isModalUnlockOpen, showUnlockModal] = useState(false);
  const [error, setError] = useState<string>();
  const [txFlow, setTxFlow] = useState<TxFlow>();
  const [isNonStandard, setIsNonStandard] = useState(false);

  const psetToSign = useSelectPopupPsetToSign();
  const hostname = useSelectPopupHostname();

  const handleModalUnlockClose = () => showUnlockModal(false);
  const handleUnlockModalOpen = () => showUnlockModal(true);

  useEffect(() => {
    const init = async () => {
      if (!psetToSign) return;
      const network = await appRepository.getNetwork();
      if (!network) throw new Error('unknown network');
      const pset = Pset.fromBase64(psetToSign);

      const mainAccountsScripts = await walletRepository.getAccountScripts(
        network,
        MainAccountLegacy,
        network === 'liquid' ? MainAccount : MainAccountTest
      );

      const unsignedTx = pset.unsignedTx();
      const txid = unsignedTx.getId();
      const unblinderSvc = new WalletRepositoryUnblinder(
        walletRepository,
        appRepository,
        assetRepository,
        await ZKPLib()
      );
      const unblindedResults = await unblinderSvc.unblind(...unsignedTx.outs);
      const updateArray: [Outpoint, UnblindingData][] = [];
      for (const [vout, unblinded] of unblindedResults.entries()) {
        if (unblinded instanceof Error) {
          if (unblinded.message === 'secp256k1_rangeproof_rewind') continue;
          if (unblinded.message === 'Empty script: fee output') continue;
          console.error('Error while unblinding', unblinded);
          continue;
        }
        updateArray.push([{ txid, vout }, unblinded]);
      }
      await walletRepository.updateOutpointBlindingData(updateArray);

      const txDetailsExtended = await computeTxDetailsExtended(
        appRepository,
        walletRepository,
        mainAccountsScripts
      )({ height: -1, hex: unsignedTx.toHex() });

      const isNonStandard =
        Object.values(txDetailsExtended.txFlow).filter((value) => value < 0).length === 0;
      setTxFlow(txDetailsExtended.txFlow);
      setIsNonStandard(isNonStandard);
    };
    init().catch((e) => {
      console.error(e);
      setError(extractErrorMessage(e));
      showToast(extractErrorMessage(e));
    });
  }, [psetToSign]);

  const sendResponseMessage = (accepted: boolean, signedPset?: string) => {
    return backgroundPort.sendMessage(popupResponseMessage({ accepted, signedPset }));
  };

  const rejectSignRequest = async () => {
    try {
      await sendResponseMessage(false);
    } catch (e) {
      console.error(e);
    }
    window.close();
  };

  const signTx = async (password: string) => {
    try {
      if (!psetToSign) throw new Error('no pset to sign');
      if (!password || password.length === 0) throw new Error('Need password');
      const signer = await SignerService.fromPassword(walletRepository, appRepository, password);
      const signedPset = await signer.signPset(Pset.fromBase64(psetToSign));
      await sendResponseMessage(true, signedPset.toBase64());
      window.close();
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    }
    handleModalUnlockClose();
  };

  // send response message false when user closes the window without answering
  window.addEventListener('beforeunload', () => sendResponseMessage(false));

  return (
    <ShellConnectPopup
      className="h-popupContent max-w-sm pb-20 text-center bg-bottom bg-no-repeat"
      currentPage="Sign PSET"
    >
      {!error ? (
        <>
          <h1 className="mt-8 text-2xl font-medium text-center break-all">{hostname}</h1>

          {!txFlow ? (
            <div className="flex flex-col items-center mt-8">
              <Spinner />
              <p className="font-medium">Loading PSET data...</p>
            </div>
          ) : (
            <div>{isNonStandard ? <NonStandardPsetWarning /> : <PsetView txFlow={txFlow} />}</div>
          )}

          <ButtonsAtBottom>
            <Button isOutline={true} onClick={rejectSignRequest} textBase={true}>
              Reject
            </Button>
            <Button onClick={handleUnlockModalOpen} textBase={true}>
              Accept
            </Button>
          </ButtonsAtBottom>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-lg font-medium">{SOMETHING_WENT_WRONG_ERROR}</h1>
          <p className="font-small mt-4 text-sm">{error}</p>
          <img className="mx-auto my-10" src="/assets/images/cross.svg" alt="error" />
          <Button
            className="w-36 container mx-auto mt-10"
            onClick={handleUnlockModalOpen}
            textBase={true}
            disabled={psetToSign === undefined}
          >
            Unlock
          </Button>
        </>
      )}
      {psetToSign && (
        <ModalUnlock
          isModalUnlockOpen={isModalUnlockOpen}
          handleModalUnlockClose={handleModalUnlockClose}
          handleUnlock={signTx}
        />
      )}
    </ShellConnectPopup>
  );
};

export default ConnectSignTransaction;
