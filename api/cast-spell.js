export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { spell } = req.body;

        if (!spell) {
            return res.status(400).json({ error: 'No spell provided in request body.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
        }

        // ✅ gemini-2.0-flash に変更（2.5-flashより高い無料枠、v1beta対応）
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const fullPrompt =
            "You are the backend engine of the game 'Spell Glitch'. " +
            "Evaluate the following spell incantation and respond ONLY with a JSON object. " +
            "No markdown, no explanation, just raw JSON.\n\n" +

            "RULES:\n" +
            "- power (float 0.1~5.0): simple spell=0.3~0.7, modified=0.8~1.5, chaotic=2.0~5.0\n" +
            "- element: fire, water, thunder, wind, dark, glitch, heal, etc.\n" +
            "- status_effect (MANDATORY):\n" +
            "  - power <= 0.7 → 'none'\n" +
            "  - power 0.8~1.4 → 'blind' or 'none'\n" +
            "  - power 1.5~2.4 → MUST be one of: poison, burn, blind\n" +
            "  - power >= 2.5  → MUST be one of: stun, curse, poison\n" +
            "- effect: short visual description\n" +
            "- log_message: flavor text for the magic tome\n\n" +

            "OUTPUT FORMAT (strict):\n" +
            "{ \"power\": float, \"element\": \"string\", \"effect\": \"string\", \"log_message\": \"string\", \"status_effect\": \"string\" }\n\n" +

            "Spell to evaluate: \"" + spell + "\"";

        const requestPayload = {
            contents: [{ parts: [{ text: fullPrompt }] }]
        };

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error("Gemini API Error Response:", errText);
            return res.status(500).json({ error: 'Failed to communicate with Gemini API.', details: errText });
        }

        const responseData = await geminiResponse.json();

        const candidate = responseData.candidates?.[0];
        if (!candidate) {
            return res.status(500).json({ error: 'No response from Gemini.' });
        }

        let rawAiText = candidate.content?.parts?.[0]?.text?.trim();
        if (!rawAiText) {
            return res.status(500).json({ error: 'Empty response from Gemini.' });
        }

        console.log("Raw AI Response:", rawAiText);

        let cleanedJsonText = rawAiText;
        if (cleanedJsonText.includes("```")) {
            cleanedJsonText = cleanedJsonText
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
        }

        const parsedGameResult = JSON.parse(cleanedJsonText);

        if (!parsedGameResult.status_effect) {
            parsedGameResult.status_effect = "none";
        }

        if (parsedGameResult.power >= 2.5 && parsedGameResult.status_effect === "none") {
            const effects = ["stun", "curse", "poison"];
            parsedGameResult.status_effect = effects[Math.floor(Math.random() * effects.length)];
        } else if (parsedGameResult.power >= 1.5 && parsedGameResult.status_effect === "none") {
            const effects = ["poison", "burn", "blind"];
            parsedGameResult.status_effect = effects[Math.floor(Math.random() * effects.length)];
        }

        return res.status(200).json(parsedGameResult);

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
}
