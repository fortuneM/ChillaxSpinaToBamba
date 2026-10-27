import React, { useState, useEffect } from 'react';
import { TvView } from './views/TvView';
import { HostView } from './views/HostView';
import { PlayerView } from './views/PlayerView';
import { LandingView } from './views/LandingView';

export function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Simple, robust client-side routing
  if (currentPath.startsWith('/tv')) {
    return <TvView />;
  }
  if (currentPath.startsWith('/host')) {
    return <HostView />;
  }
  if (currentPath.startsWith('/join')) {
    return <PlayerView />;
  }

  return <LandingView />;
}

export default App;
