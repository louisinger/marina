import { generateMnemonic, mnemonicToSeedSync } from 'bip39';
import { toOutputScript } from 'liquidjs-lib/src/address';
import { AccountType } from 'marina-provider';
import { AccountFactory, MainAccount, MainAccountLegacy, MainAccountTest } from '../src/domain/account';
import { BlockstreamExplorerURLs, BlockstreamTestnetExplorerURLs, NigiriDefaultExplorerURLs } from '../src/domain/explorer';
import { AppStorageAPI } from '../src/infrastructure/storage/app-repository';
import { WalletStorageAPI } from '../src/infrastructure/storage/wallet-repository';
import { initWalletRepository, makeAccountXPub } from '../src/infrastructure/utils';
import { SLIP13 } from '../src/utils';
import { faucet, sleep } from './_regtest';

// we need this to mock the browser.storage.local calls in repositories
jest.mock('webextension-polyfill');

const PASSWORD = 'PASSWORD';

const appRepository = new AppStorageAPI();
const walletRepository = new WalletStorageAPI();

let factory: AccountFactory;
let mnemonic: string;

describe('Account', () => {
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
             
        });

        test('should restore an account with transactions', async () => {
            const randomAccountName = 'randomAccountName' + Math.floor(Math.random() * 1000);
            const baseDerivationPath = SLIP13(randomAccountName);
            const masterXPub = makeAccountXPub(mnemonicToSeedSync(mnemonic), baseDerivationPath);
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
            await sleep(2000); // wait for the txs to be confirmed

            // then let's simulate re-onboarding by erasing the indexes
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
            expect(res.next.external).toEqual(20);
            expect(res.next.internal).toEqual(3);

            accountDetails = await walletRepository.getAccountDetails(randomAccountName);
            expect(accountDetails[randomAccountName]).toBeDefined();
            expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].external).toEqual(20);
            expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].internal).toEqual(3);
        });
    })

    afterAll(async () => {
        for (const source of factory.chainSources.values()) {
            await source.close();
        }
    });
});
