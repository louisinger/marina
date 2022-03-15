import React from 'react';
import type { TxDisplayInterface } from '../../domain/transaction';
import { formatDecimalAmount, fromSatoshi } from '../utils';
import TxIcon from './txIcon';
import moment from 'moment';

interface Props {
  assetHash: string;
  assetTicker: string;
  assetPrecision: number;
  disabled?: boolean;
  handleClick: () => void;
  tx: TxDisplayInterface;
}

const ButtonTransaction: React.FC<Props> = ({
  assetTicker,
  assetPrecision,
  disabled = false,
  tx,
  handleClick,
  assetHash,
}: Props) => {
  const transfer = tx.transfers.find((t) => t.asset === assetHash);
  return (
    <button
      disabled={disabled}
      className="focus:outline-none h-14 flex flex-row items-center justify-between w-full px-4 py-2 bg-white rounded-full shadow-md"
      onClick={() => handleClick()}
      type="button"
    >
      <div className="flex items-center">
        <TxIcon txType={tx.type} />
        <span className="text-grayDark items-center mr-2 text-xs font-medium text-left">
          {moment(tx.blockTimeMs).format('DD MMM YYYY')}
        </span>
      </div>
      <div className="flex">
        <div className="text-primary whitespace-nowrap text-sm font-medium">
          {transfer ? (transfer.amount > 0 ? '+' : '') : ''}
          {transfer ? formatDecimalAmount(fromSatoshi(transfer.amount, assetPrecision)) : '??'}{' '}
          {assetTicker}
        </div>
        <img className="ml-2" src="assets/images/chevron-right.svg" alt="chevron-right" />
      </div>
    </button>
  );
};

export default ButtonTransaction;
