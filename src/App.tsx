import { AppProvider, useApp } from './store'
import { Analyzing, Arrived, Candidates, Chat, DemoPanel, Destinations, Locate, Manual, RouteScreen, Welcome } from './screens'

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
  const Screen = SCREENS[screen]
  return (
    <div className="device" lang={lang}>
      <div className="statusbar" aria-hidden>
        <span className="num">9:41</span>
      </div>
      <Screen key={screen} />
      <DemoPanel />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <div className="stage">
        <Device />
      </div>
    </AppProvider>
  )
}
