import { crypto } from 'liquidjs-lib';
import type { BlockHeader } from '../background/utils';
import { deserializeBlockHeader } from '../background/utils';
import type { ElectrumWS } from './ws/ws-electrs';

export interface ChainSource {
  subscribeScriptStatus(
    script: Buffer,
    callback: (scripthash: string, status: string | null) => void
  ): Promise<void>;
  unsubscribeScriptStatus(script: Buffer): Promise<void>;
  fetchHistories(scripts: Buffer[]): Promise<GetHistoryResponse[]>;
  fetchTransactions(txids: string[]): Promise<{ txID: string; hex: string }[]>;
  fetchBlockHeader(height: number): Promise<BlockHeader>;
  estimateFees(targetNumberBlocks: number): Promise<number>;
  broadcastTransaction(hex: string): Promise<string>;
  getRelayFee(): Promise<number>;
  close(): Promise<void>;
}

export type GetHistoryResponse = Array<{
  tx_hash: string;
  height: number;
}>;

const BroadcastTransaction = 'blockchain.transaction.broadcast'; // returns txid
const EstimateFee = 'blockchain.estimatefee'; // returns fee rate in sats/kBytes
const GetBlockHeader = 'blockchain.block.header'; // returns block header as hex string
const GetHistoryMethod = 'blockchain.scripthash.get_history';
const GetTransactionMethod = 'blockchain.transaction.get'; // returns hex string
const SubscribeStatusMethod = 'blockchain.scripthash'; // ElectrumWS automatically adds '.subscribe'
const GetRelayFeeMethod = 'blockchain.relayfee';

export class WsElectrumChainSource implements ChainSource {
  constructor(private ws: ElectrumWS) {}

  async fetchTransactions(txids: string[]): Promise<{ txID: string; hex: string }[]> {
    console.warn('FLAG')
    const responses = await this.ws.batchRequest<string[]>(
      ...txids.map((txid) => ({ method: GetTransactionMethod, params: [txid] }))
    );
    console.warn('responses', responses)
    return responses.map((hex, i) => ({ txID: txids[i], hex }));
  }

  async unsubscribeScriptStatus(script: Buffer): Promise<void> {
    await this.ws.unsubscribe(SubscribeStatusMethod, toScriptHash(script)).catch();
  }

  async subscribeScriptStatus(
    script: Buffer,
    callback: (scripthash: string, status: string | null) => void
  ) {
    const scriptHash = toScriptHash(script);
    await this.ws.subscribe(SubscribeStatusMethod, callback, scriptHash);
  }

  async fetchHistories(scripts: Buffer[]): Promise<GetHistoryResponse[]> {
    const scriptsHashes = scripts.map((s) => toScriptHash(s));
    const responses = await this.ws.batchRequest<GetHistoryResponse[]>(
      ...scriptsHashes.map((s) => ({ method: GetHistoryMethod, params: [s] }))
    );
    return responses;
  }

  async fetchBlockHeader(height: number): Promise<BlockHeader> {
    const hex = await this.ws.request<string>(GetBlockHeader, height);
    return deserializeBlockHeader(hex);
  }

  async estimateFees(targetNumberBlocks: number): Promise<number> {
    const feeRate = await this.ws.request<number>(EstimateFee, targetNumberBlocks);
    return feeRate;
  }

  async broadcastTransaction(hex: string): Promise<string> {
    return this.ws.request<string>(BroadcastTransaction, hex);
  }

  async getRelayFee(): Promise<number> {
    return this.ws.request<number>(GetRelayFeeMethod);
  }

  async close() {
    await this.ws.close('close');
  }
}

function toScriptHash(script: Buffer): string {
  return crypto.sha256(script).reverse().toString('hex');
}
