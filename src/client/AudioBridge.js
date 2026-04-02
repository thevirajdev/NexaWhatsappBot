/**
 * AudioBridge.js
 * This script is injected into the WhatsApp Web page to facilitate 
 * audio routing between WhatsApp and Vapi.ai.
 */

window.VapiBridge = {
    isInitialized: false,
    assistantId: null,
    apiKey: null,
    
    async init(assistantId, apiKey) {
        if (this.isInitialized) return;
        this.assistantId = assistantId;
        this.apiKey = apiKey;

        console.log("[VapiBridge] Initializing AI Audio Bridge...");

        // 1. Inject Vapi Web SDK
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/gh/vapi-ai/web-sdk@latest/dist/vapi.js";
        script.onload = () => {
            console.log("[VapiBridge] Vapi SDK Loaded.");
            this.setupBridge();
        };
        document.head.appendChild(script);
        this.isInitialized = true;
    },

    async setupBridge() {
        const vapi = new window.Vapi(this.apiKey);
        
        // 2. MOCK MIC for WhatsApp
        // When WhatsApp calls getUserMedia, we want to return the AI's eventual stream
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        
        let aiStream = null;

        navigator.mediaDevices.getUserMedia = async (constraints) => {
            if (constraints.audio && aiStream) {
                console.log("[VapiBridge] Providing AI Stream to WhatsApp Mic.");
                return aiStream;
            }
            return originalGetUserMedia(constraints);
        };

        this.startCall = async (overrides = {}) => {
            console.log("[VapiBridge] Starting AI Call with overrides:", overrides);
            
            // Start Vapi Call with Dynamic Message and Prompt
            const call = await vapi.start(this.assistantId, {
                variableValues: {
                    firstMessage: overrides.firstMessage,
                    systemPrompt: overrides.systemPrompt
                }
            });
            
            call.on('call-started', () => {
                console.log("[VapiBridge] AI Call Started.");
            });

            // This is the tricky part: routing Vapi Output -> WA Input
            // In a real Vapi Web SDK, the audio goes to speakers.
            // We need to capture that and set 'aiStream'.
        };
    }
};
