import { createRoot } from "react-dom/client";
import { installGuestPolyfills } from "./polyfills";
import GuestApp from "./GuestApp";
import "../app/styles.css";
import "./guest.css";

installGuestPolyfills();
createRoot(document.getElementById("root")!).render(<GuestApp />);
