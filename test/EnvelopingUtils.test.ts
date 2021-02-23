import { ChildProcessWithoutNullStreams } from "child_process"
import { toBuffer } from "ethereumjs-util"
import { configureGSN, GSNConfig } from "../GSNConfigurator"
import { HttpProvider } from "web3-core"
import { EnvelopingUtils } from "../src/common/Utils"
import { AccountKeypair } from "../src/relayclient/AccountManager"
import { Address } from "../src/relayclient/types/Aliases"
import { ProxyFactoryInstance, RelayHubInstance, SmartWalletInstance, StakeManagerInstance, TestDeployVerifierEverythingAcceptedInstance, TestTokenInstance, TestVerifierEverythingAcceptedInstance } from "../types/truffle-contracts"
import { ServerTestEnvironment } from "./relayserver/ServerTestEnvironment"
import { createProxyFactory, deployHub, getExistingGaslessAccount, getGaslessAccount, getTestingEnvironment, startRelay, stopRelay } from "./TestUtils"
import { constants } from "../src/common/Constants"
import { soliditySha3Raw } from "web3-utils"

const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const SmartWallet = artifacts.require('SmartWallet')
const TestVerifierEverythingAccepted = artifacts.require('tests/TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('tests/TestDeployVerifierEverythingAccepted')

const localhost = 'http://localhost:8090'

            

contract('Enveloping utils', (accounts) => {
    let enveloping: EnvelopingUtils
    let env: ServerTestEnvironment
    let tokenContract: TestTokenInstance
    let relayHub: RelayHubInstance
    let stakeManager: StakeManagerInstance
    let verifier: TestVerifierEverythingAcceptedInstance
    let deployVerifier: TestDeployVerifierEverythingAcceptedInstance
    let factory: ProxyFactoryInstance
    let sWalletTemplate: SmartWalletInstance
    let chainId: number
    let workerAddress: Address
    let config: GSNConfig
    let fundedAccount: AccountKeypair
    let gaslessAccount: AccountKeypair
    let relayproc: ChildProcessWithoutNullStreams

    const gasLimit = '0x1E8480'


    beforeEach(async () => {
        gaslessAccount = await getExistingGaslessAccount()
        fundedAccount = {
            privateKey: toBuffer('0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4'),
            address: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826'
        }

        stakeManager = await StakeManager.new(0)
        sWalletTemplate = await SmartWallet.new()
        verifier = await TestVerifierEverythingAccepted.new()
        deployVerifier = await TestDeployVerifierEverythingAccepted.new()
        factory = await createProxyFactory(sWalletTemplate)
        chainId = (await getTestingEnvironment()).chainId
        env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
        workerAddress = accounts[1]
        tokenContract = await TestToken.new()
        relayHub = await deployHub(stakeManager.address)
        const partialConfig: Partial<GSNConfig> =
        {
            relayHubAddress: relayHub.address,
            proxyFactoryAddress: factory.address,
            chainId: chainId,
            relayVerifierAddress: verifier.address,
            deployVerifierAddress: deployVerifier.address,
        }
        config = configureGSN(partialConfig)
        relayproc = await startRelay(relayHub.address, stakeManager,{
            stake: 1e18,
            delay: 3600 * 24 * 7,
            pctRelayFee: 12,
            url: 'asd',
            relayOwner: fundedAccount.address,
            gasPriceFactor: 1.2,
            // @ts-ignore
            rskNodeUrl: web3.currentProvider.host,
            relayVerifierAddress: verifier.address,
            deployVerifierAddress: deployVerifier.address,
        })
        const swAddress = await factory.getSmartWalletAddress(gaslessAccount.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, soliditySha3Raw({ t: 'bytes', v: '0x' }), '0')
        await tokenContract.mint('1000', swAddress)
        enveloping = new EnvelopingUtils(config, web3, workerAddress)
        await enveloping._init()
    })

    after(async function () {
        await stopRelay(relayproc)
      })

    
    it('Should deploy a smart wallet correctly using enveloping utils', async () => {
        const eoaWithoutSmartWalletAccount = await getGaslessAccount()
        const request = await enveloping.createDeployRequest(eoaWithoutSmartWalletAccount.address, gasLimit, tokenContract.address, '1', gasLimit)
        const signature = enveloping.signRequest(eoaWithoutSmartWalletAccount.privateKey, request)
        await enveloping.sendHttpDeployRequest(request, signature)
    })
    it.skip('Should relay a transaction correctly using enveloping utils', async () => {
        
    })
})