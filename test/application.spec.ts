import { generateMnemonic, mnemonicToSeed } from 'bip39';
import { networks } from 'liquidjs-lib';
import { toOutputScript } from 'liquidjs-lib/src/address';
import { AccountType } from 'marina-provider';
import { AccountFactory, MainAccount, MainAccountLegacy, MainAccountTest } from '../src/domain/account';
import { BlinderService } from '../src/domain/blinder';
import { SignerService } from '../src/domain/signer';
import { UpdaterService } from '../src/background/updater';
import { BlockstreamExplorerURLs, BlockstreamTestnetExplorerURLs, NigiriDefaultExplorerURLs } from '../src/domain/explorer';
import { AppStorageAPI } from '../src/infrastructure/storage/app-repository';
import { AssetStorageAPI } from '../src/infrastructure/storage/asset-repository';
import { WalletStorageAPI } from '../src/infrastructure/storage/wallet-repository';
import { initWalletRepository, makeAccountXPub } from '../src/infrastructure/utils';
import { computeBalances, makeSendPsetFromMainAccounts, SLIP13 } from '../src/utils';
import { faucet, sleep } from './_regtest';

// we need this to mock the browser.storage.local calls in repositories
jest.mock('webextension-polyfill');

const PASSWORD = 'PASSWORD';

const appRepository = new AppStorageAPI();
const walletRepository = new WalletStorageAPI();
const assetRepository = new AssetStorageAPI(walletRepository);

let factory: AccountFactory;
let mnemonic: string;

describe('Application Layer', () => {
    beforeAll(async () => {
        mnemonic = generateMnemonic();
        // set up a random wallet in repository
        // also set up default main Marina accounts
        await initWalletRepository(walletRepository, mnemonic, PASSWORD);
        await appRepository.setNetwork('regtest'); // switch to regtest
        await appRepository.setWebsocketExplorerURLs({
            liquid: BlockstreamExplorerURLs.websocketExplorerURL,
            regtest: NigiriDefaultExplorerURLs.websocketExplorerURL,
            testnet: BlockstreamTestnetExplorerURLs.websocketExplorerURL,
        })
        factory = await AccountFactory.create(walletRepository, appRepository, ['liquid', 'regtest', 'testnet']);
    });


    describe('Account', () => {
        describe('AccountFactory', () => {
            for (const ID of [MainAccount, MainAccountLegacy, MainAccountTest]) {
                test(`should create ${ID} account`, async () => {
                    const account = await factory.make(ID === MainAccountTest ? 'regtest' : 'liquid', ID);
                    expect(account).toBeDefined();
                    expect(account.name).toEqual(ID);
                });
            }
        })

        describe('getNextAddress', () => {
            test('should update account details once external address is generated', async () => {
                const account = await factory.make('regtest', MainAccountTest);
                const index = (await walletRepository.getAccountDetails(MainAccountTest))[MainAccountTest].nextKeyIndexes['regtest'].external;
                const address = await account.getNextAddress(false);
                expect(address).toBeDefined();
                const scriptFromAddress = toOutputScript(address.confidentialAddress).toString('hex');
                const scripts = Object.keys(await walletRepository.getAccountScripts('regtest', MainAccountTest));
                const { [scriptFromAddress]: details } = await walletRepository.getScriptDetails(scriptFromAddress)
                expect(details).toBeDefined();
                expect(details.accountName).toEqual(MainAccountTest);
                expect(details.derivationPath).toEqual(address.derivationPath);
                expect(scripts).toContain(scriptFromAddress);
                const accountDetails = await walletRepository.getAccountDetails(MainAccountTest);
                expect(accountDetails[MainAccountTest]).toBeDefined();
                expect(accountDetails[MainAccountTest].nextKeyIndexes['regtest'].external).toEqual(index + 1);
            });

            test('should update account details once internal address is generated', async () => {
                const account = await factory.make('regtest', MainAccountTest);
                const index = (await walletRepository.getAccountDetails(MainAccountTest))[MainAccountTest].nextKeyIndexes['regtest'].internal;
                const address = await account.getNextAddress(true);
                expect(address).toBeDefined();
                const scriptFromAddress = toOutputScript(address.confidentialAddress).toString('hex');
                const scripts = Object.keys(await walletRepository.getAccountScripts('regtest', MainAccountTest));
                const { [scriptFromAddress]: details } = await walletRepository.getScriptDetails(scriptFromAddress)
                expect(details).toBeDefined();
                expect(details.accountName).toEqual(MainAccountTest);
                expect(details.derivationPath).toEqual(address.derivationPath);
                expect(scripts).toContain(scriptFromAddress);
                const accountDetails = await walletRepository.getAccountDetails(MainAccountTest);
                expect(accountDetails[MainAccountTest]).toBeDefined();
                expect(accountDetails[MainAccountTest].nextKeyIndexes['regtest'].internal).toEqual(index + 1);
            });
        });

        describe('sync', () => {
            test('should fail if the account type is AccountType.Ionio', async () => {
                const accountName = 'failTestIonioAccountSync';
                const path = SLIP13(accountName);
                const masterXPub = makeAccountXPub(await mnemonicToSeed(mnemonic), path);
                await walletRepository.updateAccountDetails(accountName, {
                    accountID: accountName,
                    accountNetworks: ['regtest'],
                    type: AccountType.Ionio,
                    baseDerivationPath: path,
                    masterXPub,
                });
                const account = await factory.make('regtest', accountName);
                await expect(account.sync()).rejects.toThrowError('Unsupported sync function for account type: ionio');
            });

            test('should restore an account with transactions (and unblind utxos via UpdaterService running in background)', async () => {
                // first let's start the UpdaterService running in background (simulating the background script UpdaterService)
                const zkpLib = await require('@vulpemventures/secp256k1-zkp')();
                const updater = new UpdaterService(walletRepository, appRepository, assetRepository, zkpLib);
                await updater.start();

                // then let's create a new random P2WPKH account
                const randomAccountName = 'randomAccountName' + Math.floor(Math.random() * 1000);
                const baseDerivationPath = SLIP13(randomAccountName);
                const masterXPub = makeAccountXPub(await mnemonicToSeed(mnemonic), baseDerivationPath);
                await walletRepository.updateAccountDetails(randomAccountName, {
                    accountID: randomAccountName,
                    accountNetworks: ['regtest'],
                    type: AccountType.P2WPKH,
                    baseDerivationPath,
                    masterXPub,
                    nextKeyIndexes: {
                        liquid: { external: 0, internal: 0 },
                        testnet: { external: 0, internal: 0 },
                        regtest: { external: 18, internal: 2 }, // let's create some gap (the 18th address is the one we will use)
                    }
                })

                // generate and faucet addresses
                let account = await factory.make('regtest', randomAccountName);
                const address = await account.getNextAddress(false);
                const txID0 = await faucet(address.confidentialAddress, 1);
                const txID1 = await faucet(address.confidentialAddress, 1);
                const addressBis = await account.getNextAddress(false);
                const txID2 = await faucet(addressBis.confidentialAddress, 1);
                const txID3 = await faucet(addressBis.confidentialAddress, 1);
                const changeAddress = await account.getNextAddress(true);
                const txID4 = await faucet(changeAddress.confidentialAddress, 1);
                const txID5 = await faucet(changeAddress.confidentialAddress, 1);
                await sleep(5000); // wait for the txs to be confirmed

                // then let's simulate re-onboarding by erasing the indexes (we "forget" the generated addresses)
                await walletRepository.updateAccountDetails(randomAccountName, {
                    nextKeyIndexes: {
                        liquid: { external: 0, internal: 0 },
                        testnet: { external: 0, internal: 0 },
                        regtest: { external: 0, internal: 0 },
                    }
                });
                let accountDetails = await walletRepository.getAccountDetails(randomAccountName);
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].external).toEqual(0);
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].internal).toEqual(0);
                account = await factory.make('regtest', randomAccountName);
                const res = await account.sync(20);
                await updater.waitForProcessing();
                expect(res.next.external).toEqual(20);
                expect(res.next.internal).toEqual(3);

                accountDetails = await walletRepository.getAccountDetails(randomAccountName);
                expect(accountDetails[randomAccountName]).toBeDefined();
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].external).toEqual(20);
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].internal).toEqual(3);

                // check is the txs are here
                const txs = await walletRepository.getTransactions('regtest');
                expect(txs).toContain(txID0);
                expect(txs).toContain(txID1);
                expect(txs).toContain(txID2);
                expect(txs).toContain(txID3);
                expect(txs).toContain(txID4);
                expect(txs).toContain(txID5);
                // check the utxos
                const utxos = await walletRepository.getUtxos('regtest', randomAccountName);
                expect(utxos).toHaveLength(6);
                const balances = computeBalances(utxos);
                expect(balances).toEqual({
                    [networks.regtest.assetHash]: 6_00_000_000,
                });
                await updater.stop();
            }, 20_000);
        })
    });

    describe('BlinderService', () => {
        let accountName;
        beforeAll(async () => {
            const zkpLib = await require('@vulpemventures/secp256k1-zkp')();
            const updater = new UpdaterService(walletRepository, appRepository, assetRepository, zkpLib);
            await updater.start();
            // create a random account for that test
            accountName = 'randomAccountName' + Math.floor(Math.random() * 1000);
            const baseDerivationPath = SLIP13(accountName);
            const masterXPub = makeAccountXPub(await mnemonicToSeed(mnemonic), baseDerivationPath);
            await walletRepository.updateAccountDetails(accountName, {
                accountID: accountName,
                accountNetworks: ['regtest'],
                type: AccountType.P2WPKH,
                baseDerivationPath,
                masterXPub,
                nextKeyIndexes: {
                    liquid: { external: 0, internal: 0 },
                    testnet: { external: 0, internal: 0 },
                    regtest: { external: 0, internal: 0 },
                }
            });
            // faucet it
            const account = await factory.make('regtest', accountName);
            const address = await account.getNextAddress(false);
            await faucet(address.confidentialAddress, 1);
            await account.sync(20, { internal: 0, external: 0 });
            await updater.waitForProcessing();
            await updater.stop();
        });

        it('should blind the outputs belonging to all accounts', async () => {
            const blinder = new BlinderService(walletRepository);
            makeSendPsetFromMainAccounts()
            const utxos = await walletRepository.getUtxos('regtest', );
        });
    });

    describe('SignerService', () => {
        it('should sign the inputs belonging to all accounts', async () => {
        });

        it('should fail if the pset is not fully blinded', async () => {

        });
    })

    afterAll(async () => {
        for (const source of factory.chainSources.values()) {
            await source.close();
        }
    });
})