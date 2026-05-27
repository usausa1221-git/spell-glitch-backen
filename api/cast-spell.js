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

        // ================================================================
        // システムプロンプト
        // ================================================================
        const systemInstruction =
            "You are the spell evaluation engine for the dark fantasy game 'Spell Glitch'.\n" +
            "The player inputs a spell incantation in English. Analyze it and return a JSON response.\n" +
            "\n" +
            "## Evaluation Criteria\n" +
            "1. **power** (float, min 0.5): Base damage multiplier.\n" +
            "   - Short, simple words → 0.5 ~ 1.0\n" +
            "   - Creative or dramatic phrasing → 1.0 ~ 1.5\n" +
            "   - Extreme, violent, or chaotic language → 1.5 ~ 2.0\n" +
            "   - Do NOT exceed 2.0. Forbidden keyword bonuses are applied separately by the game engine.\n" +
            "\n" +
            "2. **element** (string): Choose the most fitting element based on the spell's tone and words.\n" +
            "   Must be exactly one of: \"fire\", \"ice\", \"dark\", \"holy\", \"glitch\", \"none\"\n" +
            "\n" +
            "3. **status_effect** (string): A debuff inflicted on the enemy.\n" +
            "   Assign based on the NATURE of the spell, NOT its power.\n" +
            "   A weak, creeping curse can still inflict \"poison\" or \"curse\".\n" +
            "   A blinding flash inflicts \"blind\" even at low power.\n" +
            "   Must be exactly one of: \"none\", \"poison\", \"stun\", \"burn\", \"blind\", \"curse\"\n" +
            "   - poison : slow decay, toxin, rot, plague-like words\n" +
            "   - stun   : lightning, shock, paralysis, freeze-in-place words\n" +
            "   - burn   : fire, scorch, ignite, incinerate words\n" +
            "   - blind  : flash, light, darkness, shadow, obscure words\n" +
            "   - curse  : hex, doom, wither, soul, damnation words\n" +
            "   - none   : straightforward attack spells with no debuff flavor\n" +
            "\n" +
            "4. **effect** (string): A short visual effect description (max 8 words). e.g. \"crimson flames erupt from the ground\"\n" +
            "\n" +
            "5. **log_message** (string): One sentence of atmospheric flavor text describing what happened.\n" +
            "\n" +
            "## Output Format\n" +
            "You MUST return raw JSON only. No markdown, no explanation, no code fences.\n" +
            "Exact format:\n" +
            "{ \"power\": float, \"element\": \"string\", \"status_effect\": \"string\", \"effect\": \"string\", \"log_message\": \"string\" }";

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

        // ================================================================
        // サニティチェック：想定外の値が返ってきたときのフォールバック
        // ================================================================
        const validElements = ["fire", "ice", "dark", "holy", "glitch", "none"];
        const validStatuses = ["none", "poison", "stun", "burn", "blind", "curse"];

        if (!validElements.includes(parsedGameResult.element)) {
            parsedGameResult.element = "none";
        }
        if (!validStatuses.includes(parsedGameResult.status_effect)) {
            parsedGameResult.status_effect = "none";
        }
        parsedGameResult.power = Math.max(0.5, Math.min(2.0, parseFloat(parsedGameResult.power) || 1.0));

        return res.status(200).json(parsedGameResult);

    } catch (error) {
        console.error("Internal Server Error Details:", error);
        return res.status(500).json({
            error: 'Internal Server Error',
            details: error.message
        });
    }
}
