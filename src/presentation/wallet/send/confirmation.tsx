import React from 'react';
import { useHistory } from 'react-router';
import Button from '../../components/button';
import ShellPopUp from '../../components/shell-popup';
import { SEND_CHOOSE_FEE_ROUTE, SEND_END_OF_FLOW_ROUTE } from '../../routes/constants';
import { fromSatoshiStr } from '../../utils';
import type { AssetGetter } from '../../../domain/assets';
import type { TransactionState } from '../../../application/redux/reducers/transaction-reducer';
import AssetIcon from '../../components/assetIcon';

export interface ConfirmationProps {
  transaction: TransactionState;
  getAsset: AssetGetter;
}

const ConfirmationView: React.FC<ConfirmationProps> = ({ getAsset, transaction }) => {
  const history = useHistory();
  const { sendAddress, sendAsset, sendAmount, feeAsset, feeAmount } = transaction;
  const handleSend = () => history.push(SEND_END_OF_FLOW_ROUTE);
  const handleBackBtn = () => history.push(SEND_CHOOSE_FEE_ROUTE);

  return (
    <ShellPopUp
      backBtnCb={handleBackBtn}
      backgroundImagePath="/assets/images/popup/bg-sm.png"
      className="h-popupContent container pb-20 mx-auto text-center bg-bottom bg-no-repeat"
      currentPage="Confirmation"
    >
      <h1 className="text-2xl">{getAsset(sendAsset).name}</h1>
      <AssetIcon className="w-11 mt-0.5 block mx-auto mb-2" assetHash={sendAsset} />

      <div className="px-3 mt-3">
        <h2 className="text-lg font-medium text-left">To</h2>
        <p className="font-regular text-sm text-left break-all">{sendAddress?.value}</p>
      </div>

      <div className="bg-gradient-to-r from-secondary to-primary flex flex-row items-center justify-between h-12 px-4 mt-4 rounded-full">
        <span className="text-lg font-medium">Amount</span>
        <span className="text-base font-medium text-white">
          {fromSatoshiStr(sendAmount, getAsset(sendAsset).precision)} {getAsset(sendAsset).ticker}
        </span>
      </div>

      <div className="flex flex-row items-end justify-between px-3 mt-10">
        <span className="text-lg font-medium">Fee</span>
        <span className="font-regular text-base">
          {fromSatoshiStr(feeAmount, getAsset(feeAsset).precision)} {getAsset(feeAsset).ticker}
        </span>
      </div>

      <Button className="bottom-20 right-8 absolute" onClick={handleSend}>
        Send
      </Button>
    </ShellPopUp>
  );
};

export default ConfirmationView;
