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

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

        const systemInstruction =
            "You are the backend engine of the game 'Spell Glitch'. " +
            "The player inputs a spell incantation and you evaluate its power and side effects. " +
            "IMPORTANT: Output ONLY the JSON object. No explanation, no steps, no markdown, no bullet points. Just the raw JSON. " +

            "power (float 0.1~5.0): simple spell=0.3~0.7, modified=0.8~1.5, chaotic=2.0~5.0. " +
            "element: fire, water, thunder, wind, dark, glitch, heal, etc. " +
            "status_effect (MANDATORY): " +
            "power<=0.7 → none, " +
            "power 0.8~1.4 → blind or none, " +
            "power 1.5~2.4 → poison or burn or blind, " +
            "power>=2.5 → stun or curse or poison. " +
            "effect: short visual description. " +
            "log_message: flavor text. " +
            "Output format: {\"power\":float,\"element\":\"string\",\"effect\":\"string\",\"log_message\":\"string\",\"status_effect\":\"string\"}";

        const requestPayload = {
            contents: [{ parts: [{ text: spell }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
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

        // ✅ 強化版パース：テキスト中から { } のJSONブロックだけを抽出
        let cleanedJsonText = rawAiText;

        // マークダウンコードブロックを除去
        if (cleanedJsonText.includes("```")) {
            cleanedJsonText = cleanedJsonText
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
        }

        // { から } までのJSONブロックを正規表現で抽出
        const jsonMatch = cleanedJsonText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("No JSON found in response:", rawAiText);
            return res.status(500).json({ error: 'No JSON found in Gemini response.' });
        }
        cleanedJsonText = jsonMatch[0];

        const parsedGameResult = JSON.parse(cleanedJsonText);

        if (!parsedGameResult.status_effect) {
            parsedGameResult.status_effect = "none";
        }

        // powerが高いのにnoneの場合はサーバー側で補正
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
