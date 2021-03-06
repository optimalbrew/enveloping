import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'

import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance
} from '../types/truffle-contracts'
import { deployHub } from './TestUtils'

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

contract('RelayHub Relay Management', function ([_, relayOwner, relayManager, relayWorker1, relayWorker2, relayWorker3]) {
  const baseRelayFee = new BN('10')
  const pctRelayFee = new BN('20')
  const relayUrl = 'http://new-relay.com'

  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance

  beforeEach(async function () {
    stakeManager = await StakeManager.new(0)
    penalizer = await Penalizer.new()
    relayHub = await deployHub(stakeManager.address, penalizer.address)
  })

  context('without stake for relayManager', function () {
    it('should not allow relayManager to add relay workers', async function () {
      await expectRevert.unspecified(
        relayHub.addRelayWorkers([relayWorker1], {
          from: relayManager
        }),
        'relay manager not staked')
    })
    context('after stake unlocked for relayManager', function () {
      beforeEach(async function () {
        await stakeManager.stakeForAddress(relayManager, 2000, {
          value: ether('2'),
          from: relayOwner
        })
        await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
        await relayHub.addRelayWorkers([relayWorker1], { from: relayManager })
        await stakeManager.unauthorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      })

      it('should not allow relayManager to register a relay server', async function () {
        await expectRevert.unspecified(
          relayHub.registerRelayServer(baseRelayFee, pctRelayFee, relayUrl, { from: relayManager }),
          'relay manager not staked')
      })
    })
  })

  context('with stake for relayManager and no active workers added', function () {
    beforeEach(async function () {
      await stakeManager.stakeForAddress(relayManager, 2000, {
        value: ether('2'),
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    })

    it('should not allow relayManager to register a relay server', async function () {
      await expectRevert.unspecified(
        relayHub.registerRelayServer(baseRelayFee, pctRelayFee, relayUrl, { from: relayManager }),
        'no relay workers')
    })

    it('should allow relayManager to add multiple workers', async function () {
      const newRelayWorkers = [relayWorker1, relayWorker2, relayWorker3]
      const { logs } = await relayHub.addRelayWorkers(newRelayWorkers, { from: relayManager })
      expectEvent.inLogs(logs, 'RelayWorkersAdded', {
        relayManager,
        newRelayWorkers,
        workersCount: '3'
      })
    })

    it('should not allow relayManager to register already registered workers', async function () {
      await relayHub.addRelayWorkers([relayWorker1], { from: relayManager })
      await expectRevert.unspecified(
        relayHub.addRelayWorkers([relayWorker1], { from: relayManager }),
        'this worker has a manager')
    })
  })

  context('with stake for relay manager and active relay workers', function () {
    beforeEach(async function () {
      await stakeManager.stakeForAddress(relayManager, 2000, {
        value: ether('2'),
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      await relayHub.addRelayWorkers([relayWorker1], { from: relayManager })
    })

    it('should not allow relayManager to exceed allowed number of workers', async function () {
      const newRelayWorkers = []
      for (let i = 0; i < 11; i++) {
        newRelayWorkers.push(relayWorker1)
      }
      await expectRevert.unspecified(
        relayHub.addRelayWorkers(newRelayWorkers, { from: relayManager }),
        'too many workers')
    })

    it('should allow relayManager to update transaction fee and url', async function () {
      const { logs } = await relayHub.registerRelayServer(baseRelayFee, pctRelayFee, relayUrl, { from: relayManager })
      expectEvent.inLogs(logs, 'RelayServerRegistered', {
        relayManager,
        pctRelayFee,
        baseRelayFee,
        relayUrl
      })
    })
  })
})
