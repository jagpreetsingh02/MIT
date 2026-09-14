import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import "./landing.css";
import "./journey.css";
import "./otter/otter.css";
import HeroSection6 from "./components/ui/hero-section-6";
import { Workspace } from "./workspace/Workspace";

createRoot(document.getElementById("root")!).render(
  location.pathname === "/app" ? <Workspace /> : <HeroSection6 />,
);
