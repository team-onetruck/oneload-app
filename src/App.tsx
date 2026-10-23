import { useRecovery } from './features/recovery/context'
import { RecoveryProvider } from './features/recovery/RecoveryProvider'
import { AppProvider, useApp } from './store'
import { Analyzing, Arrived, Candidates, Chat, DemoPanel, Destinations, Locate, Manual, RouteScreen, SessionEnded, Welcome } from './screens'

const SCREENS = {
  welcome: Welcome,
  chat: Chat,
  locate: Locate,
  analyzing: Analyzing,
  candidates: Candidates,
  manual: Manual,
  destinations: Destinations,
  route: RouteScreen,
  arrived: Arrived,
}

function Device() {
  const { screen, lang } = useApp()
  const { ended } = useRecovery()
  const Screen = SCREENS[screen]
  return (
    <div className="device" lang={lang}>
      <div className="statusbar" aria-hidden>
        <span className="num">9:41</span>
      </div>
      {/* 세션이 끝나면 어느 화면에 있었든 세션 종료 화면으로 바꾼다 */}
      {ended ? <SessionEnded key="ended" /> : <Screen key={screen} />}
      <DemoPanel />
    </div>
  )
}

export default function App() {
  // store가 fail()을 쓸 수 있도록 RecoveryProvider를 AppProvider 바깥에 둔다
  return (
    <RecoveryProvider>
      <AppProvider>
        <div className="stage">
          <Device />
        </div>
      </AppProvider>
    </RecoveryProvider>
  )
}
