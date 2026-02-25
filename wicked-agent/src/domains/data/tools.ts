/**
 * Data domain tools.
 *
 * Dataset analysis, data pipeline review, and ML approach guidance.
 */

import { Type } from "@sinclair/typebox";
import { readFile, stat } from "node:fs/promises";
import type { PiTool, PiToolResult } from "../../types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function textResult(text: string): PiToolResult {
  return { type: "text", content: [{ type: "text", text }] };
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    return `[could not read: ${(err as Error).message}]`;
  }
}

// ── analyze_dataset ───────────────────────────────────────────────────────────

export const analyzeDatasetTool: PiTool = {
  name: "analyze_dataset",
  label: "Analyze Dataset",
  description:
    "Reads a CSV file, reports column types, row count, null rates, unique value counts, and basic statistics for numeric columns.",
  parameters: Type.Object({
    file: Type.String({
      description: "Path to the CSV file to analyze.",
    }),
    delimiter: Type.Optional(
      Type.String({ description: "CSV delimiter. Default: ','." }),
    ),
    max_rows: Type.Optional(
      Type.Number({
        description: "Maximum rows to read for analysis. Default: 10000.",
        minimum: 1,
        maximum: 1000000,
      }),
    ),
  }),

  async execute(_id, input) {
    const {
      file,
      delimiter = ",",
      max_rows = 10000,
    } = input as { file: string; delimiter?: string; max_rows?: number };

    const sections: string[] = [];
    sections.push(`# Dataset Analysis: \`${file}\``);

    // File metadata
    let fileSize = 0;
    try {
      const s = await stat(file);
      fileSize = s.size;
    } catch {
      // ignore
    }
    if (fileSize > 0) {
      sections.push(`File size: ${(fileSize / 1024).toFixed(1)} KB\n`);
    }

    const raw = await readFileSafe(file);
    if (raw.startsWith("[could not read")) {
      return textResult(`Error: ${raw}`);
    }

    // Parse CSV
    const allLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (allLines.length < 2) {
      return textResult(`Error: File has fewer than 2 lines — cannot parse headers and data.`);
    }

    const headerLine = allLines[0];
    const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const dataLines = allLines.slice(1, max_rows + 1);
    const totalRows = allLines.length - 1;
    const sampledRows = dataLines.length;

    sections.push(`## Overview`);
    sections.push(`- Columns: ${headers.length}`);
    sections.push(`- Total rows (estimated): ${totalRows}`);
    sections.push(`- Rows analyzed: ${sampledRows}`);
    if (sampledRows < totalRows) {
      sections.push(`- *Note: Analyzing first ${sampledRows} rows of ${totalRows} total.*`);
    }
    sections.push("");

    // Parse rows into column arrays
    const columnData: Record<string, string[]> = {};
    for (const h of headers) columnData[h] = [];

    for (const line of dataLines) {
      // Simple CSV parse (handles quoted fields)
      const fields = parseCSVLine(line, delimiter);
      for (let i = 0; i < headers.length; i++) {
        columnData[headers[i]].push(fields[i]?.trim() ?? "");
      }
    }

    // Analyze each column
    sections.push("## Column Analysis");
    sections.push("| Column | Type | Null% | Unique | Min | Max | Mean |");
    sections.push("|--------|------|-------|--------|-----|-----|------|");

    for (const col of headers) {
      const vals = columnData[col];
      const nullCount = vals.filter((v) => v === "" || v.toLowerCase() === "null" || v.toLowerCase() === "na" || v.toLowerCase() === "n/a").length;
      const nullPct = ((nullCount / vals.length) * 100).toFixed(1);
      const nonNull = vals.filter((v) => v !== "" && v.toLowerCase() !== "null" && v.toLowerCase() !== "na");
      const uniqueCount = new Set(vals).size;

      // Infer type
      let colType = "string";
      const numericVals = nonNull.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
      const boolVals = nonNull.filter((v) => /^(true|false|yes|no|0|1)$/i.test(v));
      const dateVals = nonNull.filter((v) => !isNaN(Date.parse(v)) && /[-/]/.test(v));

      if (numericVals.length / Math.max(nonNull.length, 1) > 0.9) {
        colType = Number.isInteger(numericVals[0]) && numericVals.every((v) => Number.isInteger(v)) ? "integer" : "float";
      } else if (boolVals.length / Math.max(nonNull.length, 1) > 0.9) {
        colType = "boolean";
      } else if (dateVals.length / Math.max(nonNull.length, 1) > 0.8) {
        colType = "date";
      }

      let minVal = "-";
      let maxVal = "-";
      let meanVal = "-";

      if (colType === "integer" || colType === "float") {
        const sorted = [...numericVals].sort((a, b) => a - b);
        minVal = sorted[0]?.toFixed(colType === "integer" ? 0 : 2) ?? "-";
        maxVal = sorted[sorted.length - 1]?.toFixed(colType === "integer" ? 0 : 2) ?? "-";
        const sum = numericVals.reduce((a, b) => a + b, 0);
        meanVal = (sum / numericVals.length).toFixed(colType === "integer" ? 1 : 3);
      } else if (colType === "string") {
        const sorted = [...nonNull].sort();
        minVal = (sorted[0] ?? "-").slice(0, 15);
        maxVal = (sorted[sorted.length - 1] ?? "-").slice(0, 15);
      }

      sections.push(`| \`${col.slice(0, 20)}\` | ${colType} | ${nullPct}% | ${uniqueCount} | ${minVal} | ${maxVal} | ${meanVal} |`);
    }

    // Data quality summary
    sections.push("\n## Data Quality Summary");

    const highNullCols = headers.filter((h) => {
      const vals = columnData[h];
      const nullCount = vals.filter((v) => v === "" || /^(null|na|n\/a)$/i.test(v)).length;
      return nullCount / vals.length > 0.2;
    });

    const highCardinalityCols = headers.filter((h) => {
      const vals = columnData[h];
      return new Set(vals).size === vals.length && vals.length > 100;
    });

    const potentialIdCols = headers.filter((h) =>
      /^(id|uuid|_id|key|pk|identifier|guid)$/i.test(h) ||
      /_(id|key|uuid)$/i.test(h)
    );

    const issues: string[] = [];
    const observations: string[] = [];

    if (highNullCols.length > 0) {
      issues.push(`High null rate (>20%) in columns: ${highNullCols.join(", ")}`);
    }
    if (highCardinalityCols.length > 0) {
      observations.push(`High-cardinality columns (all unique values — likely IDs or free text): ${highCardinalityCols.join(", ")}`);
    }
    if (potentialIdCols.length > 0) {
      observations.push(`Potential primary key columns: ${potentialIdCols.join(", ")}`);
    }

    // Duplicate row check
    const rowHashes = dataLines.map((l) => l.trim());
    const uniqueRows = new Set(rowHashes).size;
    const dupCount = rowHashes.length - uniqueRows;
    if (dupCount > 0) {
      issues.push(`${dupCount} duplicate row(s) detected — consider deduplication.`);
    } else {
      observations.push("No duplicate rows detected.");
    }

    if (issues.length > 0) {
      sections.push("### Issues");
      sections.push(issues.map((i) => `- WARNING: ${i}`).join("\n"));
    }
    if (observations.length > 0) {
      sections.push("### Observations");
      sections.push(observations.map((o) => `- ${o}`).join("\n"));
    }

    // Sample rows
    sections.push("\n## Sample Data (first 5 rows)");
    sections.push("```csv");
    sections.push(headerLine);
    sections.push(dataLines.slice(0, 5).join("\n"));
    sections.push("```");

    sections.push("\n## Recommendations");
    if (highNullCols.length > 0) {
      sections.push(`- Investigate null values in: ${highNullCols.join(", ")} — decide on imputation or exclusion strategy.`);
    }
    if (dupCount > 0) {
      sections.push(`- Remove ${dupCount} duplicate rows before further processing.`);
    }
    sections.push("- Validate column types match expected data dictionary.");
    sections.push("- Consider profiling outliers in numeric columns using IQR or z-score methods.");

    return textResult(sections.join("\n"));
  },
};

function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ── pipeline_review ───────────────────────────────────────────────────────────

export const pipelineReviewTool: PiTool = {
  name: "pipeline_review",
  label: "Data Pipeline Review",
  description:
    "Reads a data pipeline configuration file (Airflow DAG, dbt project, Spark job, etc.) and identifies common issues.",
  parameters: Type.Object({
    file: Type.String({
      description: "Path to the pipeline config file.",
    }),
    pipeline_type: Type.Optional(
      Type.Union(
        [
          Type.Literal("airflow"),
          Type.Literal("dbt"),
          Type.Literal("spark"),
          Type.Literal("generic"),
        ],
        { description: "Pipeline type for specialized checks. Default: generic." },
      ),
    ),
  }),

  async execute(_id, input) {
    const { file, pipeline_type = "generic" } = input as {
      file: string;
      pipeline_type?: "airflow" | "dbt" | "spark" | "generic";
    };

    const source = await readFileSafe(file);
    if (source.startsWith("[could not read")) {
      return textResult(`Error: ${source}`);
    }

    const lines = source.split("\n");
    const sections: string[] = [];
    sections.push(`# Data Pipeline Review: \`${file}\``);
    sections.push(`Pipeline type: **${pipeline_type}**  |  Lines: ${lines.length}\n`);

    const issues: string[] = [];
    const good: string[] = [];

    // --- Generic checks ---
    // Hardcoded credentials
    if (/(?:password|passwd|secret|api_key)\s*[=:]\s*['"][^'"]{4,}['"]/i.test(source)) {
      issues.push("CRITICAL: Hardcoded credentials detected — use environment variables or a secrets manager.");
    }

    // Connection strings with embedded passwords
    if (/(?:mysql|postgres|mongodb|redis):\/\/\w+:[^@]+@/i.test(source)) {
      issues.push("CRITICAL: Connection string with embedded password — externalize credentials.");
    }

    // Missing error handling
    if (!/(?:try|catch|except|on_failure|retry|error_handler)/i.test(source)) {
      issues.push("No error handling or retry logic detected — pipeline may fail silently on errors.");
    } else {
      good.push("Error handling or retry logic detected.");
    }

    // Logging
    if (/\blog(?:ging)?\b|\bprint\b|\bconsole\.log\b/i.test(source)) {
      good.push("Logging present in pipeline.");
    } else {
      issues.push("No logging detected — add logging at key transformation steps for observability.");
    }

    // Hardcoded dates
    const hardcodedDates = source.match(/(?:start_date|end_date|since)\s*[=:]\s*['"][0-9]{4}-[0-9]{2}-[0-9]{2}['"]/gi);
    if (hardcodedDates && hardcodedDates.length > 0) {
      issues.push(`Hardcoded date(s) detected: ${hardcodedDates.slice(0, 2).join(", ")} — use dynamic date expressions.`);
    }

    // --- Airflow-specific ---
    if (pipeline_type === "airflow") {
      if (/from\s+airflow/i.test(source)) good.push("Airflow DAG file detected.");

      // Catchup
      if (/catchup\s*=\s*True/i.test(source)) {
        issues.push("Airflow: `catchup=True` — this will backfill all missed runs. Ensure this is intentional.");
      } else if (/catchup\s*=\s*False/i.test(source)) {
        good.push("Airflow: `catchup=False` set — no backfill on deploy.");
      }

      // Schedule
      if (!/@daily|@weekly|@hourly|schedule_interval|schedule\s*=/.test(source)) {
        issues.push("Airflow: No schedule detected — DAG may never run automatically.");
      }

      // Depends on past
      if (/depends_on_past\s*=\s*True/i.test(source)) {
        issues.push("Airflow: `depends_on_past=True` — can cause cascading failures if any run fails.");
      }

      // Max retries
      if (!/(retries|max_retry_delay)/.test(source)) {
        issues.push("Airflow: No retry configuration — add `retries` and `retry_delay` to task defaults.");
      }

      // SLA
      if (/sla\s*=/i.test(source)) {
        good.push("SLA configured for DAG tasks.");
      } else {
        issues.push("Airflow: No SLA configured — consider adding SLA miss callbacks for critical pipelines.");
      }
    }

    // --- dbt-specific ---
    if (pipeline_type === "dbt") {
      if (/version\s*:/i.test(source)) good.push("dbt project version specified.");
      if (/tests\s*:/i.test(source) || /- not_null/i.test(source)) {
        good.push("dbt tests configured.");
      } else {
        issues.push("dbt: No data tests detected — add not_null, unique, and accepted_values tests.");
      }
      if (/materialized\s*:/i.test(source)) {
        good.push("Materialization strategy configured.");
      }
      if (/tags\s*:/i.test(source)) {
        good.push("dbt tags present — good for selective model runs.");
      }
    }

    // --- Spark-specific ---
    if (pipeline_type === "spark") {
      if (/cache\(\)|persist\(\)/i.test(source)) {
        good.push("Spark: DataFrame caching detected.");
      } else if (/\.collect\(\)/i.test(source)) {
        issues.push("Spark: `.collect()` detected — avoid in production; loads all data into driver memory.");
      }
      if (/repartition\(|coalesce\(/i.test(source)) {
        good.push("Spark: Explicit partitioning configured.");
      }
      if (/broadcast\(/i.test(source)) {
        good.push("Spark: Broadcast join hint used.");
      }
    }

    // --- Performance hints ---
    sections.push("## Issues Found");
    if (issues.length === 0) {
      sections.push("No critical issues detected.");
    } else {
      sections.push(issues.map((i) => `- ${i}`).join("\n"));
    }

    sections.push("\n## What's Good");
    if (good.length === 0) {
      sections.push("No positive patterns detected — review the file manually.");
    } else {
      sections.push(good.map((g) => `- ${g}`).join("\n"));
    }

    sections.push("\n## File Preview (first 40 lines)");
    sections.push("```");
    sections.push(lines.slice(0, 40).join("\n"));
    if (lines.length > 40) sections.push(`... (${lines.length - 40} more lines)`);
    sections.push("```");

    sections.push("\n## Recommendations");
    sections.push("- Add idempotency checks: re-running the pipeline should produce the same result.");
    sections.push("- Add data quality checks at source and after each major transformation.");
    sections.push("- Monitor pipeline execution time trends to detect degradation early.");
    sections.push("- Document expected input schema and output schema for each step.");

    return textResult(sections.join("\n"));
  },
};

// ── ml_guidance ───────────────────────────────────────────────────────────────

export const mlGuidanceTool: PiTool = {
  name: "ml_guidance",
  label: "ML Approach Guidance",
  description:
    "Takes a problem description and recommends appropriate ML approaches, algorithms, evaluation metrics, and implementation notes.",
  parameters: Type.Object({
    problem: Type.String({
      description: "Description of the ML problem to solve.",
    }),
    data_description: Type.Optional(
      Type.String({
        description: "Description of available data (size, features, format, labels).",
      }),
    ),
    constraints: Type.Optional(
      Type.String({
        description: "Constraints such as latency, interpretability, or infrastructure requirements.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { problem, data_description, constraints } = input as {
      problem: string;
      data_description?: string;
      constraints?: string;
    };

    const sections: string[] = [];
    sections.push("# ML Approach Guidance");
    sections.push(`\n**Problem**: ${problem}`);
    if (data_description) sections.push(`**Data**: ${data_description}`);
    if (constraints) sections.push(`**Constraints**: ${constraints}`);
    sections.push("");

    // Classify the problem type
    const probLower = problem.toLowerCase();
    let problemType = "general";
    let primaryTask = "supervised learning";

    if (/classif|categori|predict.*(?:whether|if|class)|spam|fraud|churn|sentiment|binary|multi.?class/i.test(probLower)) {
      problemType = "classification";
      primaryTask = "supervised classification";
    } else if (/regress|predict.*(?:price|amount|value|count|number|how much|forecast|sales|revenue)/i.test(probLower)) {
      problemType = "regression";
      primaryTask = "supervised regression";
    } else if (/cluster|group|segment|similar|anomal|outlier|unsupervis/i.test(probLower)) {
      problemType = "clustering/anomaly";
      primaryTask = "unsupervised learning";
    } else if (/recommend|suggest|collaborative|item.*user|user.*item/i.test(probLower)) {
      problemType = "recommendation";
      primaryTask = "recommendation system";
    } else if (/nlp|text|language|translat|summar|sentiment|ner|entity|qa|question.answer/i.test(probLower)) {
      problemType = "nlp";
      primaryTask = "natural language processing";
    } else if (/image|vision|detect|recogni|classify.*image|object|segmentat/i.test(probLower)) {
      problemType = "computer vision";
      primaryTask = "computer vision";
    } else if (/time.?series|forecast|sequence|temporal|event|predict.*future/i.test(probLower)) {
      problemType = "time series";
      primaryTask = "time series forecasting";
    } else if (/reinforc|reward|agent|policy|action/i.test(probLower)) {
      problemType = "reinforcement learning";
      primaryTask = "reinforcement learning";
    }

    sections.push(`## Problem Classification`);
    sections.push(`- **Type**: ${problemType}`);
    sections.push(`- **Primary task**: ${primaryTask}`);
    sections.push("");

    // Recommendations based on problem type
    const recommendations: Record<string, {
      approaches: Array<{ name: string; pros: string; cons: string; when: string }>;
      baseline: string;
      metrics: string[];
      frameworks: string[];
      pitfalls: string[];
    }> = {
      classification: {
        approaches: [
          { name: "Logistic Regression", pros: "Fast, interpretable, works well with scaled features", cons: "Assumes linear decision boundary", when: "Baseline, highly interpretable model required" },
          { name: "Random Forest", pros: "Handles non-linearity, robust to outliers, feature importance", cons: "Slower inference, less interpretable", when: "General purpose, feature importance needed" },
          { name: "XGBoost / LightGBM", pros: "State-of-the-art for tabular data, fast", cons: "Many hyperparameters, can overfit", when: "High accuracy on tabular data" },
          { name: "Neural Network (MLP)", pros: "Can learn complex patterns", cons: "Needs more data, less interpretable", when: "Large dataset, complex feature interactions" },
        ],
        baseline: "Logistic Regression with standardized features",
        metrics: ["Accuracy", "Precision", "Recall", "F1-score", "AUC-ROC", "Confusion Matrix"],
        frameworks: ["scikit-learn", "XGBoost", "LightGBM", "PyTorch", "TensorFlow/Keras"],
        pitfalls: [
          "Class imbalance — use SMOTE, class_weight='balanced', or stratified sampling",
          "Data leakage — ensure target variable or future data doesn't appear in features",
          "Overfitting — use cross-validation, regularization, and holdout test set",
        ],
      },
      regression: {
        approaches: [
          { name: "Linear Regression", pros: "Interpretable, fast, good baseline", cons: "Assumes linearity, sensitive to outliers", when: "Baseline, linear relationship expected" },
          { name: "Ridge / Lasso Regression", pros: "Regularized, handles multicollinearity", cons: "Still linear", when: "Many correlated features" },
          { name: "Gradient Boosting (XGBoost)", pros: "Handles non-linearity, best performance on tabular", cons: "Hyperparameter tuning needed", when: "High accuracy required" },
          { name: "Neural Network", pros: "Flexible, learns complex patterns", cons: "Data hungry, less interpretable", when: "Very large datasets" },
        ],
        baseline: "Linear Regression with feature scaling",
        metrics: ["MAE", "RMSE", "R²", "MAPE"],
        frameworks: ["scikit-learn", "XGBoost", "LightGBM", "PyTorch"],
        pitfalls: [
          "Skewed target variable — consider log transform",
          "Outliers — use robust regression or remove extreme values",
          "Heteroscedasticity — check residual plots",
        ],
      },
      "clustering/anomaly": {
        approaches: [
          { name: "K-Means", pros: "Simple, fast, scalable", cons: "Assumes spherical clusters, need to pick k", when: "Well-separated clusters, known k" },
          { name: "DBSCAN", pros: "Finds arbitrary-shaped clusters, detects outliers", cons: "Sensitive to epsilon and minPoints", when: "Anomaly detection, irregular cluster shapes" },
          { name: "Isolation Forest", pros: "Efficient anomaly detection, handles high dimensions", cons: "Less interpretable", when: "Anomaly/outlier detection" },
          { name: "Autoencoder", pros: "Learns compressed representation, great for complex anomalies", cons: "Needs more data and tuning", when: "High-dimensional anomaly detection" },
        ],
        baseline: "K-Means for clustering; Isolation Forest for anomaly detection",
        metrics: ["Silhouette Score", "Davies-Bouldin Index", "Precision/Recall at threshold (anomaly)"],
        frameworks: ["scikit-learn", "PyOD", "PyTorch"],
        pitfalls: [
          "Scaling is critical — normalize features before clustering",
          "Curse of dimensionality — apply PCA or dimensionality reduction first",
          "Choosing the right number of clusters — use elbow method or silhouette analysis",
        ],
      },
      nlp: {
        approaches: [
          { name: "TF-IDF + Classifier", pros: "Fast, interpretable, low resource", cons: "No semantic understanding", when: "Baseline, simple text classification" },
          { name: "Sentence Transformers (SBERT)", pros: "Semantic embeddings, transfer learning", cons: "Larger model, GPU preferred", when: "Semantic similarity, search, clustering" },
          { name: "Fine-tuned BERT/RoBERTa", pros: "State-of-the-art for most NLP tasks", cons: "Expensive to train, large model", when: "High accuracy on classification/NER/QA" },
          { name: "GPT-based (few-shot)", pros: "No labeled data needed", cons: "Expensive inference, unpredictable", when: "Limited labeled data, generative tasks" },
        ],
        baseline: "TF-IDF + Logistic Regression for classification; SBERT for embeddings",
        metrics: ["F1-score", "BLEU (generation)", "BERTScore", "Accuracy", "Precision/Recall"],
        frameworks: ["HuggingFace Transformers", "spaCy", "NLTK", "LangChain"],
        pitfalls: [
          "Data preprocessing: tokenization, lowercasing, stopword removal matter",
          "Class imbalance in text classification",
          "Model hallucination in generative tasks — always validate outputs",
          "Tokenization limits — long documents need chunking strategy",
        ],
      },
      "time series": {
        approaches: [
          { name: "ARIMA / SARIMA", pros: "Classical, interpretable, good for stationary series", cons: "Manual seasonality tuning", when: "Univariate, stationary time series" },
          { name: "Prophet (Meta)", pros: "Handles seasonality and holidays automatically", cons: "Less flexible for complex series", when: "Business time series with seasonality" },
          { name: "LSTM / Temporal Transformer", pros: "Learns long-range dependencies", cons: "Needs lots of data, tuning", when: "Complex multivariate time series" },
          { name: "Gradient Boosting with lag features", pros: "Strong baseline, interpretable", cons: "Manual feature engineering", when: "Tabular time series, feature-rich data" },
        ],
        baseline: "Prophet or SARIMA for univariate; lag-feature XGBoost for multivariate",
        metrics: ["MAE", "RMSE", "MAPE", "sMAPE"],
        frameworks: ["statsmodels", "Prophet", "PyTorch (LSTM)", "Darts", "NeuralForecast"],
        pitfalls: [
          "Data leakage: use time-based train/test split, never random split",
          "Missing timestamps — ensure regular intervals or handle gaps explicitly",
          "Stationarity — check with ADF test; difference series if needed",
          "Multiple seasonalities — weekly + yearly patterns require decomposition",
        ],
      },
    };

    const rec = recommendations[problemType] ?? {
      approaches: [
        { name: "Start with a simple baseline", pros: "Fast to implement", cons: "May underperform", when: "Always" },
        { name: "Gradient Boosting (XGBoost/LightGBM)", pros: "Strong general-purpose model", cons: "Tabular data focused", when: "Structured data" },
      ],
      baseline: "Simple heuristic or linear model",
      metrics: ["Accuracy", "F1-score", "MAE", "RMSE — choose based on task"],
      frameworks: ["scikit-learn", "XGBoost", "PyTorch"],
      pitfalls: ["Start simple before complex models", "Validate on held-out data"],
    };

    sections.push("## Recommended Approaches");
    sections.push(`**Baseline to start with**: ${rec.baseline}\n`);

    for (const approach of rec.approaches) {
      sections.push(`\n### ${approach.name}`);
      sections.push(`- **When to use**: ${approach.when}`);
      sections.push(`- **Pros**: ${approach.pros}`);
      sections.push(`- **Cons**: ${approach.cons}`);
    }

    sections.push("\n## Evaluation Metrics");
    sections.push(rec.metrics.map((m) => `- ${m}`).join("\n"));

    sections.push("\n## Recommended Frameworks");
    sections.push(rec.frameworks.map((f) => `- ${f}`).join("\n"));

    sections.push("\n## Common Pitfalls");
    sections.push(rec.pitfalls.map((p) => `- ${p}`).join("\n"));

    sections.push("\n## Implementation Roadmap");
    sections.push("1. **EDA**: Explore data distributions, missing values, correlations.");
    sections.push("2. **Baseline**: Implement simplest possible model to establish benchmark.");
    sections.push("3. **Feature Engineering**: Extract meaningful features; handle missing data.");
    sections.push("4. **Model Selection**: Try 2-3 algorithms; compare via cross-validation.");
    sections.push("5. **Hyperparameter Tuning**: Use RandomSearchCV or Optuna.");
    sections.push("6. **Evaluation**: Use held-out test set; report multiple metrics.");
    sections.push("7. **Deployment**: Export model, build inference API, set up monitoring.");
    sections.push("8. **Monitoring**: Track prediction distribution drift and accuracy over time.");

    if (constraints) {
      sections.push("\n## Constraint Considerations");
      const constraintLower = constraints.toLowerCase();
      if (/interpret|explain/i.test(constraintLower)) {
        sections.push("- **Interpretability required**: Use SHAP values with tree models, or Linear/Logistic Regression for full interpretability.");
      }
      if (/latency|real.?time|fast|< ?[0-9]+ms/i.test(constraintLower)) {
        sections.push("- **Low latency**: Prefer shallow tree models or quantized neural networks; avoid large transformers for inference.");
      }
      if (/edge|embedded|mobile|no gpu/i.test(constraintLower)) {
        sections.push("- **Edge deployment**: Use ONNX export, model quantization, or lightweight models (scikit-learn, ONNX Runtime).");
      }
    }

    return textResult(sections.join("\n"));
  },
};
