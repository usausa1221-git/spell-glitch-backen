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

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // ✅ 強化版：状態異常が積極的に発生するプロンプト
        const systemInstruction = 
            "You are the backend engine of the game 'Spell Glitch'. " +
            "The player inputs a spell incantation and you evaluate its power and side effects. " +

            "STEP 1 - Determine power (float between 0.1 and 5.0): " +
            "- Simple clean spell (e.g. 'fire', 'heal'): power 0.3~0.7 " +
            "- Modified spell (e.g. 'mega fire', 'super heal'): power 0.8~1.5 " +
            "- Chaotic spell (e.g. 'EXPLODE EVERYTHING', 'ultra death glitch'): power 2.0~5.0 " +

            "STEP 2 - Determine element string: fire, water, thunder, wind, dark, glitch, heal, etc. " +

            "STEP 3 - Determine status_effect. This is a MANDATORY field. Rules: " +
            "- power <= 0.7: status_effect = 'none' (safe spell) " +
            "- power 0.8~1.4: 50% chance of a minor effect. Choose 'blind' or 'none'. " +
            "- power 1.5~2.4: MUST apply a status effect. Choose from: poison, burn, blind. " +
            "- power >= 2.5: MUST apply a heavy status effect. Choose from: stun, curse, poison. " +
            "Effect meanings for flavor: " +
            "- poison: spell corrupted player's blood, HP drains each turn " +
            "- stun: recoil overloaded player's mana circuits, skip next turn " +
            "- burn: backfire scorched the caster " +
            "- blind: targeting array glitched, damage halved next turn " +
            "- curse: dark energy backlash, max MP reduced temporarily " +

            "STEP 4 - Write effect (short visual effect description) and log_message (flavor text for the magic tome). " +

            "You MUST output raw JSON only, no markdown, no explanation. Exact format: " +
            "{ \"power\": float, \"element\": \"string\", \"effect\": \"string\", \"log_message\": \"string\", \"status_effect\": \"string\" } " +
            "status_effect MUST be exactly one of: none, poison, stun, burn, blind, curse. Never omit this field.";

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

        // フォールバック：status_effectが欠落している場合
        if (!parsedGameResult.status_effect) {
            parsedGameResult.status_effect = "none";
        }

        // powerが高いのにnoneの場合はサーバー側で上書き補正
        if (parsedGameResult.power >= 2.5 && parsedGameResult.status_effect === "none") {
            const heavyEffects = ["stun", "curse", "poison"];
            parsedGameResult.status_effect = heavyEffects[Math.floor(Math.random() * heavyEffects.length)];
            console.log(`Power override: applied status_effect = ${parsedGameResult.status_effect}`);
        } else if (parsedGameResult.power >= 1.5 && parsedGameResult.status_effect === "none") {
            const midEffects = ["poison", "burn", "blind"];
            parsedGameResult.status_effect = midEffects[Math.floor(Math.random() * midEffects.length)];
            console.log(`Power override: applied status_effect = ${parsedGameResult.status_effect}`);
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
