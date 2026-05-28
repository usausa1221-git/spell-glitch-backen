using UnityEngine;
using System.Collections;
using System.Text;
using UnityEngine.Networking;
using TMPro;

public class SpellInputManager : MonoBehaviour
{
    [SerializeField] private TMP_InputField spellInputField;
    [SerializeField] private TMP_Text damageText;

    [Header("Battle System Reference")]
    [SerializeField] private BattleStatusManager statusManager;

    [Header("Network Configuration")]
    [SerializeField] private string vercelApiUrl = "https://spell-glitch-backen-o8y5y68wo-takuto-s-lolprojects.vercel.app/api/cast-spell";

    [Header("Turn UI")]
    [SerializeField] private TMP_Text turnIndicatorText; // ✅ 「Your Turn」「Enemy Turn」表示用

    // 敵が使う呪文のリスト（Gemmaが評価する）
    private string[] enemySpells = {
        "Dark Nova", "Shadow Fang", "Void Burst",
        "Crimson Flame", "Thunder Crush", "Poison Mist",
        "Chaos Bolt", "Death Whisper", "Glitch Storm"
    };

    [System.Serializable]
    public class SpellResult
    {
        public float power;
        public string element;
        public string effect;
        public string log_message;
        public string status_effect;
    }

    private void Start()
    {
        StartCoroutine(StartBattle());
    }

    // ✅ バトル開始：先攻後攻を決定してターンを開始
    private IEnumerator StartBattle()
    {
        yield return new WaitForSeconds(0.5f);
        bool playerFirst = statusManager.DeterminePlayerGoesFirst();

        if (playerFirst)
        {
            statusManager.SetPlayerTurn();
            UpdateTurnUI("Your Turn! Chant a spell.");
            SetInputInteractable(true);
        }
        else
        {
            statusManager.SetEnemyTurn();
            UpdateTurnUI("Enemy goes first!");
            SetInputInteractable(false);
            yield return new WaitForSeconds(1.5f);
            StartCoroutine(EnemyTurn());
        }
    }

    // ✅ プレイヤーが詠唱ボタンを押したとき
    public void OnCastSpell()
    {
        if (statusManager.IsBattleOver) return;
        if (statusManager.CurrentTurn != BattleStatusManager.TurnState.PlayerTurn) return;

        string playerInput = spellInputField.text.Trim();

        if (!string.IsNullOrEmpty(playerInput))
        {
            if (!statusManager.CanCastSpell(10))
            {
                damageText.text = statusManager.IsStunned
                    ? "[Stun] STUNNED! Cannot cast spell this turn."
                    : "Not enough MP!";

                if (statusManager.IsStunned)
                {
                    // スタン中はターンだけ消費
                    statusManager.ProcessTurnEffects();
                    StartCoroutine(AfterPlayerTurn());
                }
                return;
            }

            SetInputInteractable(false);
            damageText.text = "Analyzing Incantation...";
            StartCoroutine(PlayerTurn(playerInput));
            spellInputField.text = "";
        }
        else
        {
            damageText.text = "No incantation entered!";
        }
    }

    // ✅ プレイヤーターンの処理
    private IEnumerator PlayerTurn(string spellText)
    {
        yield return StartCoroutine(SendSpellToServer(spellText, isEnemy: false, (result) =>
        {
            if (result == null) return;

            statusManager.ConsumePlayerMP(10);
            statusManager.ApplyDamageToEnemy(result.power, result.element);
            statusManager.ApplyStatusEffect(result.status_effect ?? "none");
            statusManager.ProcessTurnEffects();

            float finalDamage = 100f * result.power;
            string statusLine = (!string.IsNullOrEmpty(result.status_effect) && result.status_effect != "none")
                ? $"[!] Status Effect: {result.status_effect.ToUpper()}\n" : "";

            damageText.text =
                $"[Spell Glitch Triggered!]\n" +
                $"Element: {result.element}\n" +
                $"Effect: {result.effect}\n" +
                $"Damage: {Mathf.FloorToInt(finalDamage)}\n" +
                statusLine +
                $"\nLog: {result.log_message}";
        }));

        if (!statusManager.IsBattleOver)
            StartCoroutine(AfterPlayerTurn());
    }

    // ✅ プレイヤーターン終了後：敵ターンへ移行
    private IEnumerator AfterPlayerTurn()
    {
        yield return new WaitForSeconds(2.0f);
        statusManager.SetEnemyTurn();
        UpdateTurnUI("Enemy's Turn...");
        yield return new WaitForSeconds(1.0f);
        StartCoroutine(EnemyTurn());
    }

    // ✅ 敵ターンの処理
    private IEnumerator EnemyTurn()
    {
        if (statusManager.IsBattleOver) yield break;

        // 敵がランダムに呪文を選択
        string enemySpell = enemySpells[Random.Range(0, enemySpells.Length)];
        Debug.Log($"敵が詠唱：{enemySpell}");

        yield return StartCoroutine(SendSpellToServer(enemySpell, isEnemy: true, (result) =>
        {
            if (result == null) return;

            // 敵の攻撃をプレイヤーに適用
            statusManager.ApplyEnemyAttackToPlayer(result.power, result.element);

            // 敵の呪文の副作用（プレイヤーに状態異常）
            if (!string.IsNullOrEmpty(result.status_effect) && result.status_effect != "none")
                statusManager.ApplyStatusEffect(result.status_effect);

            statusManager.ShowEnemyAction(result.effect, result.element, result.power, result.log_message, result.status_effect ?? "none");
        }));

        if (!statusManager.IsBattleOver)
            StartCoroutine(AfterEnemyTurn());
    }

    // ✅ 敵ターン終了後：プレイヤーターンへ移行
    private IEnumerator AfterEnemyTurn()
    {
        yield return new WaitForSeconds(2.0f);
        statusManager.SetPlayerTurn();
        UpdateTurnUI("Your Turn! Chant a spell.");
        SetInputInteractable(true);
    }

    // ✅ サーバー通信の共通処理（プレイヤー・敵どちらも使う）
    private IEnumerator SendSpellToServer(string spellText, bool isEnemy, System.Action<SpellResult> onComplete)
    {
        // is_enemyフラグをJSONに含める
        string jsonBody = "{\"spell\":\"" + spellText + "\",\"is_enemy\":" + (isEnemy ? "true" : "false") + "}";

        using (UnityWebRequest request = new UnityWebRequest(vercelApiUrl, "POST"))
        {
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonBody);
            request.uploadHandler   = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.ConnectionError ||
                request.result == UnityWebRequest.Result.ProtocolError)
            {
                Debug.LogError("API Error: " + request.error);
                if (!isEnemy) damageText.text = "Mana unstable! Connection failed.";
                onComplete(null);
                yield break;
            }

            string raw = request.downloadHandler.text;
            Debug.Log($"[{(isEnemy ? 'E' : 'P')}] Server Response: " + raw);

            try
            {
                SpellResult result = JsonUtility.FromJson<SpellResult>(raw);
                onComplete(result);
            }
            catch (System.Exception ex)
            {
                Debug.LogError("JSON Parse Error: " + ex.Message);
                if (!isEnemy) damageText.text = "Glitch Overload!";
                onComplete(null);
            }
        }
    }

    private void UpdateTurnUI(string message)
    {
        if (turnIndicatorText != null)
            turnIndicatorText.text = message;
    }

    private void SetInputInteractable(bool interactable)
    {
        if (spellInputField != null) spellInputField.interactable = interactable;
    }
}
