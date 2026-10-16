import { Route, Routes } from "react-router";
import { PublicHeader } from "./components/PublicHeader";
import { HomePage } from "./pages/HomePage";

// Render the public header and the page matching the current URL.
function App() {
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
