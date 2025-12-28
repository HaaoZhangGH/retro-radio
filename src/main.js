import "./styles.css";
import { createApp } from "./app/ui.js";

import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });
createApp().mount();
