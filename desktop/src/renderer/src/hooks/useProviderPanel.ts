import { useState, type Dispatch, type SetStateAction } from 'react'
import type { SetupState } from '../components/SetupPanel'
import type { ProviderStatus } from '../types'

export function useProviderPanel(setSetupState: Dispatch<SetStateAction<SetupState | null>>) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [checking, setChecking] = useState<Record<string, string>>({})

  const refreshProviders = () => window.aicli.listProviders().then(setProviders)

  async function handleInstall(name: string) {
    setSetupState({ provider: name, action: 'install', log: '', running: true, code: null })
    const { code } = await window.aicli.installProvider(name)
    setSetupState((s) => (s ? { ...s, running: false, code } : s))
    refreshProviders()
  }

  async function handleLogin(name: string) {
    setSetupState({ provider: name, action: 'login', log: '', running: true, code: null })
    const { code } = await window.aicli.loginProvider(name)
    setSetupState((s) => (s ? { ...s, running: false, code } : s))
    refreshProviders()
  }

  async function handleCheckConnection(name: string) {
    setChecking((c) => ({ ...c, [name]: 'Checking...' }))
    const { status } = await window.aicli.checkConnection(name)
    setChecking((c) => ({ ...c, [name]: status === 'SUCCESS' ? '' : status }))
    refreshProviders()
  }

  return { providers, checking, refreshProviders, handleInstall, handleLogin, handleCheckConnection }
}
