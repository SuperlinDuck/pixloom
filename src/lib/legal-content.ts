export type LegalSection = {
  title: string
  paragraphs?: string[]
  bullets?: string[]
}

export type LegalDocument = {
  title: string
  summary: string
  updated: string
  sections: LegalSection[]
}

type LegalDocumentKey = "terms" | "privacy" | "refund" | "cancellation"

const en: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    title: "Terms of Service",
    summary: "These terms govern access to PixLoom, an independently operated digital service for creating AI-assisted product imagery.",
    updated: "Effective and last updated: July 14, 2026",
    sections: [
      { title: "1. Acceptance and eligibility", paragraphs: ["By accessing or using PixLoom, you agree to these Terms. You must be at least 18 years old and legally able to enter into a contract. If you do not agree, do not use the service."] },
      { title: "2. The service", paragraphs: ["PixLoom provides digital tools that help users generate and organize product images and related visual assets. PixLoom does not sell or ship physical goods. Features, generation limits, supported models, and output quality may change as the service develops."] },
      { title: "3. Accounts and security", paragraphs: ["You are responsible for accurate account information, protecting your login credentials, and all activity performed through your account. Notify support@pixloom.io promptly if you suspect unauthorized access."] },
      { title: "4. Acceptable use", paragraphs: ["You may only upload content you have the right to use. You may not use PixLoom to create or distribute illegal, deceptive, infringing, abusive, sexually exploitative, or otherwise harmful content, or to bypass technical safeguards."], bullets: ["Do not impersonate people or misrepresent products.", "Do not upload confidential or personal data without authorization.", "Do not interfere with the service, scrape it at scale, or resell access without written permission."] },
      { title: "5. Your content and generated output", paragraphs: ["You retain your rights in content you upload. You grant PixLoom a limited permission to process that content only as needed to operate, secure, and improve the service. Subject to applicable law and third-party rights, you may use generated outputs for your business. You are responsible for reviewing outputs before publication and for ensuring that your use does not infringe another party's rights or make misleading claims."] },
      { title: "6. Plans, billing, and promotions", paragraphs: ["Paid plans are billed monthly or annually as shown at checkout and renew automatically until cancelled. The final currency, price, taxes, billing period, and total charge are displayed before payment. Annual savings shown on the pricing page compare the annual price with twelve monthly payments at the then-current monthly rate; they are not a separate cash rebate. Promotional terms shown at checkout or with a specific offer also apply. Renewal occurs at the then-current price, subject to any notice required by law."], bullets: ["You authorize PixLoom and its payment processor to charge the selected payment method.", "Generation allowances and unused credits expire as described for the applicable plan and have no cash value.", "Cancellation and refund rules are set out in the Cancellation Policy and Refund & Dispute Policy."] },
      { title: "7. Availability and changes", paragraphs: ["We aim to keep the service available but do not guarantee uninterrupted or error-free operation. Maintenance, provider outages, safety concerns, or legal requirements may affect availability. We may modify or discontinue features and will provide reasonable notice when a material change adversely affects a paid plan where practicable."] },
      { title: "8. Suspension and termination", paragraphs: ["We may restrict or terminate access for material violations of these Terms, fraud, non-payment, security risks, or legal requirements. You may stop using the service at any time. Subscription cancellation is governed by the Cancellation Policy."] },
      { title: "9. Disclaimers and responsibility", paragraphs: ["AI-generated outputs can be inaccurate, inconsistent, or similar to other content. PixLoom is provided on an “as available” basis to the extent permitted by law. You remain responsible for product claims, advertising compliance, intellectual-property review, and final commercial use. Nothing in these Terms excludes rights or liabilities that cannot legally be excluded."] },
      { title: "10. Contact and changes to these Terms", paragraphs: ["Questions may be sent to support@pixloom.io. We may update these Terms to reflect service, legal, or operational changes. The effective date above will be updated, and material changes will be communicated where required."] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    summary: "This policy explains what information PixLoom collects, why it is used, and the choices available to you.",
    updated: "Effective and last updated: July 14, 2026",
    sections: [
      { title: "1. Information we collect", bullets: ["Account information, such as your name, email address, login provider, and account identifiers.", "Content you provide, including product descriptions, prompts, uploaded images, settings, and generated outputs.", "Usage and technical information, such as pages used, feature activity, device/browser data, approximate location derived from IP address, and diagnostic logs.", "Subscription and transaction information. Payments are processed by payment providers such as Stripe; PixLoom does not store complete payment-card numbers.", "Messages and support information you send to support@pixloom.io."] },
      { title: "2. How we use information", bullets: ["Provide, maintain, personalize, and secure PixLoom.", "Process image-generation requests and store results requested by you.", "Manage accounts, subscriptions, payments, support, and service communications.", "Detect fraud, abuse, security incidents, and violations of our Terms.", "Analyze and improve reliability and features, using aggregated or de-identified information where appropriate.", "Comply with law and enforce our agreements."] },
      { title: "3. Service providers and disclosures", paragraphs: ["We share information only as needed with providers that support hosting, authentication, storage, AI processing, analytics, customer support, and payments. These providers process information under their own terms and applicable data-protection obligations. We may also disclose information when required by law, to protect users and the service, or as part of a business transfer. We do not sell personal information for money."] },
      { title: "4. AI processing", paragraphs: ["Uploaded images, prompts, and related instructions may be transmitted to AI and infrastructure providers to generate the output you request. Do not upload sensitive personal information or content you are not authorized to process. Provider retention and training settings may vary by service configuration; contact us if you need information about a particular request."] },
      { title: "5. Retention and deletion", paragraphs: ["We retain account and service data for as long as needed to provide PixLoom, meet legal and accounting requirements, resolve disputes, and protect the service. You may request account or content deletion by emailing support@pixloom.io. Some records may remain in backups or be retained where legally required."] },
      { title: "6. International processing and security", paragraphs: ["PixLoom and its providers may process information in countries other than yours. We use reasonable technical and organizational measures designed to protect information, but no online service can guarantee absolute security."] },
      { title: "7. Your choices and rights", paragraphs: ["Depending on your location, you may have rights to access, correct, delete, restrict, or receive a copy of your personal information, and to object to or withdraw consent for certain processing. Email support@pixloom.io to make a request. We may verify your identity before completing it."] },
      { title: "8. Children", paragraphs: ["PixLoom is not intended for children under 18, and we do not knowingly collect their personal information. Contact us if you believe a child has provided information to the service."] },
      { title: "9. Contact and policy updates", paragraphs: ["Privacy questions and requests may be sent to support@pixloom.io. We may update this policy as the service or legal requirements change. The updated date will appear above, and material changes will be communicated where required."] },
    ],
  },
  refund: {
    title: "Refund & Dispute Policy",
    summary: "PixLoom provides immediately accessible digital services. This policy explains when payment corrections or refunds may be available and how disputes are handled.",
    updated: "Effective and last updated: July 14, 2026",
    sections: [
      { title: "1. Digital service; no physical returns", paragraphs: ["PixLoom does not sell or ship physical goods, so there is no physical return process. Free plans do not generate refundable fees."] },
      { title: "2. General refund rule", paragraphs: ["Paid subscription fees are generally non-refundable after a billing period begins because access and generation capacity are made available immediately. This does not limit any mandatory refund or cancellation right provided by applicable law."] },
      { title: "3. Cases eligible for review", bullets: ["A duplicate or incorrect charge.", "An unauthorized charge reported promptly after discovery.", "A material service failure caused by PixLoom that prevented use of the paid service and could not be resolved within a reasonable time.", "Another situation in which applicable law requires a refund."] },
      { title: "4. How to request a refund or raise a billing dispute", paragraphs: ["Email support@pixloom.io within 14 days of the charge. Include your PixLoom account email, charge date and amount, payment receipt or invoice reference, and a short explanation. Do not send full card numbers or identity documents by email."], bullets: ["We normally acknowledge requests within 2 business days.", "We may request reasonable information needed to verify the account or charge.", "We will send the decision by email after reviewing the request."] },
      { title: "5. Approved refunds", paragraphs: ["Approved refunds are returned to the original payment method. Banks and payment providers typically require additional processing time; PixLoom cannot control when the credit appears after it has been issued. Subscription access or related generation allowances may be reduced or removed when a refund is granted."] },
      { title: "6. Chargebacks and resolution", paragraphs: ["Please contact support@pixloom.io first so we can investigate and attempt to resolve a billing issue. Nothing in this policy prevents you from exercising rights available through your bank, card issuer, payment provider, or applicable law. We will provide relevant transaction records when responding to a formal payment dispute."] },
      { title: "7. Contact", paragraphs: ["Refund and billing questions: support@pixloom.io."] },
    ],
  },
  cancellation: {
    title: "Cancellation Policy",
    summary: "You can cancel a PixLoom paid subscription at any time. This policy explains timing, access, and renewal effects.",
    updated: "Effective and last updated: July 14, 2026",
    sections: [
      { title: "1. Automatic renewal", paragraphs: ["Monthly and annual paid subscriptions renew automatically at the end of each billing period until cancelled. The billing cycle, total charge, currency, and applicable taxes are displayed before checkout."] },
      { title: "2. How to cancel", paragraphs: ["Send a cancellation request from your account email address to support@pixloom.io with the subject “Cancel subscription.” Include the PixLoom account email and plan name. We normally acknowledge the request within 2 business days and send a cancellation confirmation by email." ] },
      { title: "3. When cancellation takes effect", paragraphs: ["Cancellation stops the next automatic renewal and normally takes effect at the end of the current paid billing period. You may continue using paid features until that date, unless the account is terminated for a Terms violation or a refund requires earlier removal of access. Submit the request before the renewal date; a charge already processed is handled under the Refund & Dispute Policy."] },
      { title: "4. Fees, credits, and plan changes", paragraphs: ["Cancellation does not normally create a prorated refund for unused time. Unused generation allowances have no cash value and expire when the applicable plan or billing period ends. Any refund required by law or approved under the Refund & Dispute Policy remains available."] },
      { title: "5. Account and data", paragraphs: ["Cancelling a paid subscription does not automatically delete your account. You may ask us to delete your account and eligible stored content by emailing support@pixloom.io. Retention required for legal, security, or accounting purposes may continue as described in the Privacy Policy."] },
      { title: "6. Contact", paragraphs: ["Cancellation questions and requests: support@pixloom.io."] },
    ],
  },
}

const zh: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    title: "服务条款",
    summary: "本条款适用于使用 PixLoom。PixLoom 是一项独立运营、用于创建 AI 辅助商品视觉素材的数字服务。",
    updated: "生效及最后更新日期：2026 年 7 月 14 日",
    sections: [
      { title: "1. 接受条款与使用资格", paragraphs: ["访问或使用 PixLoom 即表示你同意本条款。你必须年满 18 周岁并具备订立合同的法律能力；不同意本条款时，请勿使用本服务。"] },
      { title: "2. 服务内容", paragraphs: ["PixLoom 提供帮助用户生成、整理商品图片及相关视觉素材的数字工具，不销售或配送实体商品。随着产品发展，功能、生成额度、支持的模型和输出质量可能发生变化。"] },
      { title: "3. 账户与安全", paragraphs: ["你应提供准确的账户信息、妥善保护登录凭据，并对账户中的活动负责。如发现未经授权的访问，请及时联系 support@pixloom.io。"] },
      { title: "4. 可接受使用", paragraphs: ["你只能上传自己有权使用的内容。不得利用 PixLoom 制作或传播违法、欺骗、侵权、虐待、性剥削或其他有害内容，也不得绕过技术与安全措施。"], bullets: ["不得冒充他人或虚假描述商品。", "未经授权不得上传机密信息或个人数据。", "不得干扰服务、进行大规模抓取，或未经书面许可转售服务访问权限。"] },
      { title: "5. 用户内容与生成结果", paragraphs: ["你保留上传内容所享有的权利，并授予 PixLoom 仅为运营、保护和改进服务所需的有限处理权限。在适用法律和第三方权利允许的范围内，你可以将生成结果用于业务。发布前应自行审查结果，并确保相关使用不侵犯他人权利、不构成虚假或误导性宣传。"] },
      { title: "6. 套餐、计费与优惠", paragraphs: ["付费套餐按照结账页面显示的月度或年度周期计费，并在取消前自动续费。最终币种、价格、税费、计费周期与扣款总额会在付款前展示。定价页显示的年度节省金额，是年度价格与按当时月价连续支付 12 个月的比较，并非额外现金返还；特定优惠页面或结账页面列明的附加条件同样适用。续费按届时有效价格进行，并在法律要求时提前通知。"], bullets: ["你授权 PixLoom 及其支付服务商向所选付款方式扣款。", "套餐生成额度及未使用额度按相应套餐规则到期，不具有现金价值。", "取消与退款分别适用《取消政策》和《退款与争议政策》。"] },
      { title: "7. 服务可用性与变更", paragraphs: ["我们会努力保持服务可用，但不保证服务始终不中断或没有错误。维护、供应商故障、安全问题或法律要求可能影响服务。我们可能调整或停止功能；在可行且付费套餐受到重大不利影响时，会给予合理通知。"] },
      { title: "8. 暂停与终止", paragraphs: ["如发生严重违反条款、欺诈、未付款、安全风险或法律要求，我们可能限制或终止访问。你可以随时停止使用服务；订阅取消按照《取消政策》处理。"] },
      { title: "9. AI 结果与责任", paragraphs: ["AI 生成结果可能不准确、不一致，或与其他内容相似。在法律允许的范围内，PixLoom 按现状及可用状态提供。你仍需对商品陈述、广告合规、知识产权审查及最终商业使用负责。本条款不排除法律规定不得排除的消费者权利或责任。"] },
      { title: "10. 联系与条款更新", paragraphs: ["如有问题，请联系 support@pixloom.io。我们可能根据服务、法律或运营变化更新条款，并更新上述生效日期；法律要求时会就重大变更另行通知。"] },
    ],
  },
  privacy: {
    title: "隐私政策",
    summary: "本政策说明 PixLoom 收集哪些信息、使用目的以及你可以作出的选择。",
    updated: "生效及最后更新日期：2026 年 7 月 14 日",
    sections: [
      { title: "1. 我们收集的信息", bullets: ["账户信息，例如姓名、邮箱地址、登录服务商和账户标识符。", "你提交的内容，包括商品描述、提示词、上传图片、设置与生成结果。", "使用和技术信息，例如访问页面、功能活动、设备/浏览器信息、由 IP 地址推断的大致位置和诊断日志。", "订阅与交易信息。付款由 Stripe 等支付服务商处理，PixLoom 不存储完整银行卡号。", "你发送至 support@pixloom.io 的消息及客服信息。"] },
      { title: "2. 信息使用方式", bullets: ["提供、维护、个性化并保护 PixLoom。", "处理图片生成请求，并按照你的要求保存结果。", "管理账户、订阅、付款、客服及服务通知。", "发现欺诈、滥用、安全事件和违反服务条款的行为。", "在适当情况下使用汇总或去标识化信息分析并改进服务。", "遵守法律并执行相关协议。"] },
      { title: "3. 服务商与信息披露", paragraphs: ["我们仅在必要范围内向提供托管、身份验证、存储、AI 处理、分析、客服和支付服务的供应商共享信息。这些供应商依据其条款和适用的数据保护义务处理信息。法律要求、保护用户与服务安全或业务转让时，我们也可能披露相关信息。我们不会以收取金钱为目的出售个人信息。"] },
      { title: "4. AI 处理", paragraphs: ["为生成你请求的结果，上传图片、提示词及相关指令可能被传输给 AI 与基础设施服务商。请勿上传敏感个人信息或你无权处理的内容。供应商的数据保留及模型训练设置可能随具体服务配置而异；如需了解特定请求的处理情况，请联系我们。"] },
      { title: "5. 保存与删除", paragraphs: ["我们会在提供 PixLoom、满足法律和会计要求、解决争议及保护服务所需的期间保存账户和服务数据。你可以发送邮件至 support@pixloom.io 请求删除账户或内容。部分记录可能保留在备份中，或因法律要求继续保存。"] },
      { title: "6. 跨境处理与安全", paragraphs: ["PixLoom 及其供应商可能在你所在国家或地区之外处理信息。我们采取合理的技术和组织措施保护信息，但任何在线服务都无法保证绝对安全。"] },
      { title: "7. 你的选择与权利", paragraphs: ["根据你所在地区，你可能有权访问、更正、删除、限制处理或获取个人信息副本，并可对特定处理提出异议或撤回同意。请通过 support@pixloom.io 提交请求；处理前我们可能验证你的身份。"] },
      { title: "8. 未成年人", paragraphs: ["PixLoom 不面向 18 岁以下未成年人，我们不会故意收集其个人信息。如你认为未成年人向服务提交了信息，请联系我们。"] },
      { title: "9. 联系与政策更新", paragraphs: ["隐私相关问题和请求可发送至 support@pixloom.io。我们可能根据服务或法律变化更新本政策，并更新上述日期；法律要求时会就重大变更另行通知。"] },
    ],
  },
  refund: {
    title: "退款与争议政策",
    summary: "PixLoom 提供即时可访问的数字服务。本政策说明何时可以申请账单更正或退款，以及如何处理付款争议。",
    updated: "生效及最后更新日期：2026 年 7 月 14 日",
    sections: [
      { title: "1. 数字服务，无实体退货", paragraphs: ["PixLoom 不销售或配送实体商品，因此不设实体商品退货流程。免费套餐不会产生可退款费用。"] },
      { title: "2. 一般退款规则", paragraphs: ["由于订阅开始后会立即提供服务访问权限和生成额度，已开始计费周期的订阅费用通常不予退还。本规则不限制适用法律规定的强制退款或取消权利。"] },
      { title: "3. 可以申请审核的情况", bullets: ["重复扣款或扣款金额错误。", "发现后及时报告的未经授权扣款。", "因 PixLoom 原因导致付费服务在合理时间内持续无法使用，且问题无法解决。", "适用法律要求退款的其他情况。"] },
      { title: "4. 如何申请退款或提出账单争议", paragraphs: ["请在扣款后 14 日内发送邮件至 support@pixloom.io，并提供 PixLoom 账户邮箱、扣款日期与金额、收据或账单编号及简要原因。请勿通过邮件发送完整银行卡号或身份证件。"], bullets: ["我们通常会在 2 个工作日内确认收到申请。", "为核实账户或扣款，我们可能要求提供合理的补充信息。", "完成审核后，我们会通过邮件告知结果。"] },
      { title: "5. 已批准的退款", paragraphs: ["获批退款将原路退回付款方式。银行和支付服务商通常还需要处理时间；PixLoom 无法控制退款发出后的实际到账时间。退款获批后，相关订阅访问权限或生成额度可能相应减少或取消。"] },
      { title: "6. 拒付与争议解决", paragraphs: ["建议先联系 support@pixloom.io，以便我们调查并尝试解决账单问题。本政策不妨碍你依法向银行、发卡机构或支付服务商行使权利。处理正式付款争议时，我们会提交相关交易记录。"] },
      { title: "7. 联系方式", paragraphs: ["退款与账单问题：support@pixloom.io。"] },
    ],
  },
  cancellation: {
    title: "取消政策",
    summary: "你可以随时取消 PixLoom 付费订阅。本政策说明取消时间、服务访问和续费处理方式。",
    updated: "生效及最后更新日期：2026 年 7 月 14 日",
    sections: [
      { title: "1. 自动续费", paragraphs: ["月付及年付订阅会在每个计费周期结束时自动续费，直至取消。结账前会显示计费周期、扣款总额、币种及适用税费。"] },
      { title: "2. 如何取消", paragraphs: ["请使用账户邮箱向 support@pixloom.io 发送邮件，主题注明“取消订阅”，并提供 PixLoom 账户邮箱和套餐名称。我们通常会在 2 个工作日内确认收到请求，并通过邮件发送取消确认。"] },
      { title: "3. 取消何时生效", paragraphs: ["取消会停止下一次自动续费，通常在当前已付费周期结束时生效。在此日期之前你仍可使用付费功能，但因违反服务条款而终止账户，或退款需要提前取消权限的情况除外。请在续费日期前提交请求；已经完成的扣款按照《退款与争议政策》处理。"] },
      { title: "4. 费用、额度与套餐调整", paragraphs: ["取消通常不会对未使用期间按比例退款。未使用的生成额度不具有现金价值，并在对应套餐或计费周期结束时失效。法律要求或依据《退款与争议政策》批准的退款不受影响。"] },
      { title: "5. 账户与数据", paragraphs: ["取消付费订阅不会自动删除账户。你可以发送邮件至 support@pixloom.io 请求删除账户和符合条件的已存储内容。因法律、安全或会计要求需要保留的信息，将按照《隐私政策》继续保存。"] },
      { title: "6. 联系方式", paragraphs: ["取消相关问题与请求：support@pixloom.io。"] },
    ],
  },
}

export function getLegalDocument(locale: string, document: LegalDocumentKey) {
  return (locale === "zh" ? zh : en)[document]
}

