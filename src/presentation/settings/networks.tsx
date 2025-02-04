import { NetworkString } from 'ldk';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { changeNetwork } from '../../application/redux/actions/app';
import { flushUtxos } from '../../application/redux/actions/utxos';
import { setDeepRestorerGapLimit, startDeepRestorer } from '../../application/redux/actions/wallet';
import { ProxyStoreDispatch } from '../../application/redux/proxyStore';
import { RootReducerState } from '../../domain/common';
import Select from '../components/select';
import ShellPopUp from '../components/shell-popup';
import { formatNetwork } from '../utils';

const availableNetworks: NetworkString[] = ['liquid', 'testnet', 'regtest'];
const formattedNetworks = availableNetworks.map((n) => formatNetwork(n));

export interface SettingsNetworksProps {
  restorationLoading: boolean;
  updaterIsloading: boolean;
  error?: string;
}

const SettingsNetworksView: React.FC<SettingsNetworksProps> = ({
  restorationLoading,
  updaterIsloading,
  error,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const network = useSelector((state: RootReducerState) => state.app.network);
  const dispatch = useDispatch<ProxyStoreDispatch>();

  const selectedNetwork = formatNetwork(network);

  const setSelectedValue = async (net: string) => {
    setIsLoading(true);
    const newNetwork = net.toLowerCase();
    if (newNetwork !== network) {
      await dispatch(changeNetwork(newNetwork as NetworkString));
      await dispatch(flushUtxos());
      await dispatch(setDeepRestorerGapLimit(20));
      await dispatch(startDeepRestorer());
    }
    setIsLoading(false);
  };

  return (
    <ShellPopUp
      btnDisabled={isLoading || restorationLoading}
      backgroundImagePath="/assets/images/popup/bg-sm.png"
      className="h-popupContent container pb-20 mx-auto text-center bg-bottom bg-no-repeat"
      currentPage="Networks"
    >
      <p className="font-regular my-8 text-base text-left">Select the network</p>
      <Select
        disabled={isLoading || restorationLoading || updaterIsloading}
        list={formattedNetworks}
        selected={selectedNetwork}
        onSelect={setSelectedValue}
      />

      {(isLoading || restorationLoading) && <p className="m-2">{'loading'}...</p>}
      {updaterIsloading && <p className="m-2">{'updater is loading'}...</p>}
      {error && <p className="m-2">{error}</p>}
    </ShellPopUp>
  );
};

export default SettingsNetworksView;
