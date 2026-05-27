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

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // ✅ 更新：状態異常判定をプロンプトに追加
        const systemInstruction = 
            "You are the backend engine of the game 'Spell Glitch'. " +
            "Evaluate the user's spell input based on: " +
            "1. Original sound retention (Does it sound like a base magic spell?) " +
            "2. Creativity and madness (Does it contain power words like extreme, super, explode?) " +
            "3. Demerits (If power is extremely high, add status penalties). " +
            "Also determine ONE status effect to apply to the PLAYER as a demerit based on the spell's chaos level. " +
            "Status effect rules: " +
            "- 'none': normal spell, no side effect. " +
            "- 'poison': chaotic spell, player loses HP each turn. " +
            "- 'stun': very unstable spell, player skips next cast. " +
            "- 'burn': fire/explosion spell gone wrong, player takes burn damage. " +
            "- 'blind': corrupted targeting, player's damage is halved next turn. " +
            "- 'curse': darkest glitch, player's max MP is reduced temporarily. " +
            "You MUST output raw JSON only, matching the exact format: " +
            "{ \"power\": float, \"element\": \"string\", \"effect\": \"string\", \"log_message\": \"string\", \"status_effect\": \"string\" } " +
            "status_effect must be one of: none, poison, stun, burn, blind, curse";

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
            return res.status(500).json({ error: 'Failed to communicate with Gemini API.' });
        }

        const responseData = await geminiResponse.json();
        let rawAiText = responseData.candidates[0].content.parts[0].text.trim();
        console.log("Raw AI Response:", rawAiText);

        let cleanedJsonText = rawAiText;
        if (cleanedJsonText.includes("```")) {
            cleanedJsonText = cleanedJsonText
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
        }

        const parsedGameResult = JSON.parse(cleanedJsonText);

        // ✅ status_effectが含まれていない場合のフォールバック
        if (!parsedGameResult.status_effect) {
            parsedGameResult.status_effect = "none";
        }

        return res.status(200).json(parsedGameResult);

    } catch (error) {
        console.error("Internal Server Error Details:", error);
        return res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
}
