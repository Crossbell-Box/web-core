import useAsync from '@/hooks/useAsync'
import type { TransactionDetails } from '@safe-global/safe-gateway-typescript-sdk'
import { getMultiSendCallOnlyContractInstance } from '@/services/contracts/safeContracts'
import { useCurrentChain } from '@/hooks/useChains'
import useSafeInfo from '@/hooks/useSafeInfo'
import { encodeMultiSendData } from '@crossbell-box/safe-core-sdk/dist/src/utils/transactions/utils'
import { Button, DialogContent, Typography } from '@mui/material'
import SendToBlock from '@/components/tx/SendToBlock'
import { useMemo, useState } from 'react'
import { generateDataRowValue } from '@/components/transactions/TxDetails/Summary/TxDataRow'
import { Errors, logError } from '@/services/exceptions'
import ErrorMessage from '@/components/tx/ErrorMessage'
import type { BatchExecuteData } from '@/components/tx/modals/BatchExecuteModal/index'
import DecodedTxs from '@/components/tx/modals/BatchExecuteModal/DecodedTxs'
import { getMultiSendTxs, getTxsWithDetails } from '@/utils/transactions'
import { TxSimulation } from '@/components/tx/TxSimulation'
import { dispatchBatchExecution } from '@/services/tx/tx-sender'
import useOnboard from '@/hooks/wallets/useOnboard'
import { WrongChainWarning } from '@/components/tx/WrongChainWarning'

const ReviewBatchExecute = ({ data, onSubmit }: { data: BatchExecuteData; onSubmit: (data: null) => void }) => {
  const [isSubmittable, setIsSubmittable] = useState<boolean>(true)
  const [submitError, setSubmitError] = useState<Error | undefined>()
  const chain = useCurrentChain()
  const { safe } = useSafeInfo()
  const onboard = useOnboard()

  const [txsWithDetails, error, loading] = useAsync<TransactionDetails[]>(() => {
    if (!chain?.chainId) return

    return getTxsWithDetails(data.txs, chain.chainId)
  }, [data.txs, chain?.chainId])

  const multiSendContract = useMemo(() => {
    if (!chain?.chainId || !safe.version) return
    return getMultiSendCallOnlyContractInstance(chain.chainId, safe.version)
  }, [chain?.chainId, safe.version])

  const multiSendTxs = useMemo(() => {
    if (!txsWithDetails || !chain || !safe.version) return
    return getMultiSendTxs(txsWithDetails, chain, safe.address.value, safe.version)
  }, [chain, safe.address.value, safe.version, txsWithDetails])

  const multiSendTxData = useMemo(() => {
    if (!txsWithDetails || !multiSendTxs) return
    return encodeMultiSendData(multiSendTxs)
  }, [txsWithDetails, multiSendTxs])

  const onExecute = async () => {
    if (!onboard || !multiSendTxData || !multiSendContract || !txsWithDetails) return

    setIsSubmittable(false)
    setSubmitError(undefined)

    try {
      await dispatchBatchExecution(txsWithDetails, multiSendContract, multiSendTxData, onboard, safe.chainId)
    } catch (err) {
      logError(Errors._804, (err as Error).message)
      setIsSubmittable(true)
      setSubmitError(err as Error)
    }

    onSubmit(null)
  }

  const submitDisabled = loading || !isSubmittable

  return (
    <div>
      <DialogContent>
        <Typography variant="body2" mb={2}>
          This transaction batches a total of {data.txs.length} transactions from your queue into a single Ethereum
          transaction. Please check every included transaction carefully, especially if you have rejection transactions,
          and make sure you want to execute all of them. Included transactions are highlighted in green when you hover
          over the execute button.
        </Typography>

        {multiSendContract && <SendToBlock address={multiSendContract.getAddress()} title="Interact with:" />}

        {multiSendTxData && (
          <>
            <Typography mt={2} color="primary.light">
              Data (hex encoded)
            </Typography>
            {generateDataRowValue(multiSendTxData, 'rawData')}
          </>
        )}

        <Typography mt={2} color="primary.light">
          Batched transactions:
        </Typography>
        <DecodedTxs txs={txsWithDetails} />

        {multiSendTxs && <TxSimulation canExecute transactions={multiSendTxs} disabled={submitDisabled} />}

        <WrongChainWarning />

        <Typography variant="body2" mt={2} textAlign="center">
          Be aware that if any of the included transactions revert, none of them will be executed. This will result in
          the loss of the allocated transaction fees.
        </Typography>

        {error && (
          <ErrorMessage error={error}>
            This transaction will most likely fail. To save gas costs, avoid creating the transaction.
          </ErrorMessage>
        )}

        {submitError && (
          <ErrorMessage error={submitError}>Error submitting the transaction. Please try again.</ErrorMessage>
        )}

        <Button
          onClick={onExecute}
          disabled={submitDisabled}
          variant="contained"
          sx={{ position: 'absolute', bottom: '24px', right: '24px', zIndex: 1 }}
        >
          Send
        </Button>
      </DialogContent>
    </div>
  )
}

export default ReviewBatchExecute
