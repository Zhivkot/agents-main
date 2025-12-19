import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { AgentChat } from './components/AgentChat';
import './App.css';

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="app-container">
          <header className="app-header">
            <h1>🤖 AgentCore Chat</h1>
            <div className="user-info">
              <span>{user?.signInDetails?.loginId}</span>
              <button onClick={signOut} className="sign-out-btn">
                Sign out
              </button>
            </div>
          </header>

          <main className="app-main">
            <AgentChat userId={user?.userId} />
          </main>
        </div>
      )}
    </Authenticator>
  );
}

export default App;
