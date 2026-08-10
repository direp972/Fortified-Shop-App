import React from "react";
import ReactDOM from "react-dom/client";
import ShopOrderApp from "./App.jsx";
import { AuthProvider } from "./lib/AuthProvider";
import AuthGate from "./AuthGate";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <ShopOrderApp />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);
